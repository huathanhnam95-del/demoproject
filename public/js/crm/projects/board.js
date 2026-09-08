(function (globalScope) {
    'use strict';

    const STATUS_KEYS = ['not_started', 'in_progress', 'blocked', 'done'];
    const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
    const PRIORITY_KEYS = ['none', 'low', 'medium', 'high', 'urgent'];
    const PRIORITY_LABELS = { none: 'None', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    const ROW_HEIGHT = 46;
    const OVERSCAN = 8;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        let authorityPending = true;
        let sectionCreatePending = false;
        let columnEditor = null;
        const settingsDrafts = new Map();

        function currentProjectId() { return String(selection.selectedProjectId || '').trim(); }
        function role() { return membership?.role || selection.selectedProject?.role || ''; }
        // Rendering a retained editor never grants mutation authority.
        function canRenderTaskEditor() { return !!project && String(project.id) === currentProjectId() && String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid && (project.lifecycle || 'active') === 'active' && (role() === 'Owner' || role() === 'Editor'); }
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
            deps.onContextChanged?.(contextSnapshot());
            return next.slice();
        }
        function toggleSelection(taskId) {
            if (!selectableTask(tasks.get(taskId))) return;
            if (!selectedTaskIds.includes(taskId) && selectedTaskIds.length >= 20) { setStatus('Select at most 20 tasks.', 'error'); return; }
            setSelectedTaskIds(selectedTaskIds.includes(taskId) ? selectedTaskIds.filter(id => id !== taskId) : [...selectedTaskIds, taskId]);
        }
        function contextSnapshot() {
            if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) { if (project || tasks.size) invalidateAccess(currentProjectId()); resetColumnForm(); selectedTaskIds = []; stateModel?.setSelectedTaskIds?.([]); }
            return { project, actorUid: controllerActorUid, authorityPending, authorizationReady: !authorityPending && hasProject(), filterOptionsReady: !!project && !busy && !authorityPending, authorityRevision, membership, members: members.slice(), sections: sections.slice(), columns: columns.slice(), tasks: new Map(tasks), selectedTaskId, selectedTaskIds: selectedTaskIds.slice() };
        }

        function setBusy(value) {
            loadBusy = value === true;
            busy = loadBusy || [...columnMovesPending].some(scopeIsCurrent);
            if (elements.projectsBoardSection) elements.projectsBoardSection.setAttribute('aria-busy', busy ? 'true' : 'false');
            if (elements.projectsBoardProjectSelect) elements.projectsBoardProjectSelect.disabled = !selection.projects.length;
            if (elements.projectsBoardRefresh) elements.projectsBoardRefresh.disabled = busy;
            if (elements.projectsBoardAddTask) elements.projectsBoardAddTask.disabled = busy || !canWrite();
            if (elements.projectsBoardAddSection) elements.projectsBoardAddSection.disabled = busy || !canSchema();
            if (elements.projectsBoardAddColumn) elements.projectsBoardAddColumn.disabled = busy || !canSchema();
            if (elements.projectsBoardSaveSettings) elements.projectsBoardSaveSettings.disabled = busy || !canSchema();
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
                externalFocus: !!active && active !== document.body && !Object.entries(elements).some(([name, element]) => name.startsWith('projectsBoard') && element && (element === active || element.contains?.(active))),
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
            if (elements.projectsBoardScroll) elements.projectsBoardScroll.scrollTop = view.scrollTop || 0;
            if (elements.projectsBoardScroll) elements.projectsBoardScroll.scrollLeft = view.scrollLeft || 0;
            if (view.externalFocus) return;
            let target = view.controlId ? document.getElementById(view.controlId) : null;
            if (!target && view.taskId && view.selectionControl) {
                target = elements.projectsBoardRows?.querySelector(`[data-task-id="${CSS.escape(view.taskId)}"] [data-action="select-task"]`) || null;
            }
            if (!target && view.taskId && view.fieldKind) {
                const row = elements.projectsBoardRows?.querySelector(`[data-task-id="${CSS.escape(view.taskId)}"]`);
                target = row?.querySelector(`[data-field-kind="${CSS.escape(view.fieldKind)}"]${view.columnId ? `[data-column-id="${CSS.escape(view.columnId)}"]` : ''}`) || null;
            }
            if (!target && view.sectionId && view.fieldKind) {
                const row = elements.projectsBoardRows?.querySelector(`[data-section-id="${CSS.escape(view.sectionId)}"]`);
                target = row?.querySelector(`[data-field-kind="${CSS.escape(view.fieldKind)}"]`) || null;
            }
            if (target) {
                target.focus?.();
                if (view.selectionStart !== null && typeof target.setSelectionRange === 'function') {
                    try { target.setSelectionRange(view.selectionStart, view.selectionEnd ?? view.selectionStart, view.selectionDirection || 'none'); } catch (_) { /* select range is optional */ }
                }
                return;
            }
            if (view.activeId) elements.projectsBoardRows?.querySelector(`[data-row-id="${CSS.escape(view.activeId)}"]`)?.focus?.();
        }

        function invalidateAccess(deniedProjectId, notifyViews = true) {
            if (String(deniedProjectId || '') !== currentProjectId()) return;
            remoteObserver?.stop(); draftBases.clear();
            projectEpoch++; refreshSequence++; authorityPending = true;
            stateModel?.switchProject('');
            selection = { projects: selection.projects.filter((entry) => String(entry.id) !== String(deniedProjectId)), selectedProjectId: '', selectedProject: null };
            project = null; membership = null; members = []; sections = []; columns = []; tasks = new Map();
            selectedTaskId = ''; selectedTaskIds = []; focusedRowId = ''; logicalRows = [];
            expanded.clear(); loadedBranches.clear(); branchCursors.clear(); branchHasMore.clear(); branchLoadChains.clear();
            drafts.clear(); draftVersions.clear(); settingsDrafts.clear(); pending.clear(); movePending.clear();
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
                remoteObserver?.stop(); draftBases.clear();
                selectedTaskIds = [];
                sharedFilters = {};
                globalScope.CrmProjectsRecovery?.setSelection(null);
                globalScope.CrmProjectsDiscussion?.setSelection(null);
                projectEpoch += 1;
                authorityPending = true;
                stateModel?.switchProject(nextId);
                resetSectionForm(); resetColumnForm();
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
                expanded.clear(); loadedBranches.clear(); branchCursors.clear(); branchHasMore.clear();
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
                drafts = new Map(); settingsDrafts.clear(); expanded = new Set();
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
                setStatus('Loading project board…');
            }
            let successMessage = '';
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
                    ? `${role()} access · ${tasks.size} loaded task${tasks.size === 1 ? '' : 's'}.`
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
                    if (successMessage) setStatus(successMessage);
                }
            }
        }

        function childrenOf(parentTaskId) {
            const parent = parentTaskId || null;
            return Array.from(tasks.values())
                .filter((task) => (task.parentTaskId || null) === parent && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active')
                .sort(rankCompare);
        }

        function rootsForSection(sectionId) {
            return Array.from(tasks.values())
                .filter((task) => !task.parentTaskId && (task.effectiveSectionId || task.sectionId) === sectionId && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active')
                .sort(rankCompare);
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
            sections.forEach((section) => {
                rows.push({ kind: 'section', id: `section:${section.id}`, section, depth: 0 });
                rootsForSection(section.id).forEach((task) => appendTask(task, 0));
            });
            return rows;
        }

        function statusOptions(current, labels = {}) {
            return STATUS_KEYS.map((key) => `<option value="${key}"${current === key ? ' selected' : ''}>${escape(labels[key] || STATUS_LABELS[key])}</option>`).join('');
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
        function customCell(task, column) {
            const raw = task.values?.[column.id] ?? null;
            const draftKey = draftKeyFor(task.id, `value:${column.id}`);
            const value = drafts.has(draftKey) ? drafts.get(draftKey) : raw;
            const disabled = canWrite() && !busy && !movePending.has(pendingKey(task.id)) ? '' : ' disabled';
            const label = escape(column.label || column.id);
            const unavailable = column.type === 'dropdown' && value && !asArray(column.options).some(option => option.key === value);
            if (!canRenderTaskEditor()) return `<span class="crm-board-null">${escape(unavailable ? `${value} (unavailable)` : value === null || value === undefined || value === '' ? '—' : (Array.isArray(value) ? value.join(', ') : value))}</span>`;
            if (column.type === 'status') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}>${statusOptions(value, column.statusLabels || {})}</select>`;
            if (column.type === 'priority') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}>${priorityOptions(value || 'none')}</select>`;
            if (column.type === 'dropdown') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}><option value="">Clear</option>${unavailable ? `<option value="${escape(value)}" selected disabled>${escape(value)} (unavailable)</option>` : ''}${asArray(column.options).map((option) => `<option value="${escape(option.key)}"${value === option.key ? ' selected' : ''}>${escape(option.label || option.key)}</option>`).join('')}</select>`;
            if (column.type === 'people') return `<select multiple class="crm-board-field crm-board-people-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}>${memberOptions(value, true)}</select>`;
            const inputType = column.type === 'number' ? 'number' : (column.type === 'date' ? 'date' : 'text');
            const inputValue = Array.isArray(value) ? value.join(', ') : (value ?? '');
            const inputState = (authorityPending || busy) && canRenderTaskEditor() ? ' readonly' : disabled;
            return `<input class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" type="${inputType}" value="${escape(inputValue)}" aria-label="${label}"${inputState}>`;
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
            const indent = Math.min(24, row.depth * 22);
            const expander = hasPotentialChildren(task) ? `<button type="button" class="crm-board-expander" data-action="toggle-task" aria-label="${expanded.has(String(task.id)) ? 'Collapse' : 'Expand'} ${escape(title)}" aria-expanded="${expanded.has(String(task.id)) ? 'true' : 'false'}">${expanded.has(String(task.id)) ? '▾' : '▸'}</button>` : '<span class="crm-board-expander" aria-hidden="true"></span>';
            const selectionCheckbox = selectableTask(task) ? `<input type="checkbox" data-action="select-task" aria-label="Select ${escape(title)}"${selectedTaskIds.includes(String(task.id)) ? ' checked' : ''}>` : '';
            const inputState = (authorityPending || busy) && canRenderTaskEditor() ? ' readonly' : disabled;
            const titleCell = canRenderTaskEditor()
                ? `<input class="crm-board-title-input crm-board-field" data-field-kind="title" type="text" value="${escape(title)}" aria-label="Task title"${inputState}>`
                : `<span class="crm-board-title-text">${escape(title)}</span>`;
            return `<div class="crm-projects-board-row${selected ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}" role="row" tabindex="0"${canWrite() ? ' aria-keyshortcuts="Alt+ArrowRight Alt+ArrowLeft" aria-description="Alt+Right indents; Alt+Left outdents. Tab navigates controls."' : ''} draggable="${canWrite() && !busy && !movePending.has(pendingKey(task.id)) ? 'true' : 'false'}" data-row-kind="task" data-row-id="${escape(row.id)}" data-task-id="${escape(task.id)}" aria-selected="${selected ? 'true' : 'false'}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px">
              <div class="crm-projects-board-cell crm-projects-board-task-title" role="cell" style="padding-left:${10 + indent}px">${task.contextOnly ? '<span class="crm-projects-context">Context</span>' : ''}${selectionCheckbox}${expander}<button type="button" class="crm-board-drag-handle" data-action="drag-handle" aria-label="Move ${escape(title)}">⠿</button>${titleCell}</div>
              <div class="crm-projects-board-cell" role="cell"><select class="crm-board-field" data-field-kind="status" aria-label="Status"${disabled}>${statusOptions(task.status || 'not_started', project?.statusLabels || {})}</select></div>
              <div class="crm-projects-board-cell" role="cell"><select class="crm-board-field" data-field-kind="ownerUid" aria-label="Accountable owner"${disabled}>${memberOptions(ownerUid)}</select></div>
              <div class="crm-projects-board-cell" role="cell"><select multiple class="crm-board-field crm-board-people-field" data-field-kind="assigneeUids" aria-label="Additional assignees"${disabled}>${memberOptions(assignees, true)}</select></div>
              <div class="crm-projects-board-cell crm-board-date-cell" role="cell"><input class="crm-board-field" data-field-kind="startDate" type="date" value="${escape(startDate)}" aria-label="Start date"${disabled}><input class="crm-board-field" data-field-kind="dueDate" type="date" value="${escape(dueDate)}" aria-label="Due date"${disabled}></div>
              ${columns.map((column) => `<div class="crm-projects-board-cell" role="cell">${customCell(task, column)}</div>`).join('')}
            </div>`;
        }

        function sectionRowMarkup(row) {
            const section = row.section;
            const title = asText(section.title, 'Section');
            const editable = canSchema() && !busy
                ? `<input class="crm-board-section-input crm-board-field" data-field-kind="section-title" type="text" value="${escape(title)}" aria-label="Section title">`
                : `<span>${escape(title)}</span>`;
            return `<div class="crm-projects-board-section-row" role="row" tabindex="0" draggable="${canSchema() && !busy ? 'true' : 'false'}" data-row-kind="section" data-row-id="${escape(row.id)}" data-section-id="${escape(section.id)}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px"><div role="cell"><span class="crm-board-drag-handle" aria-hidden="true">⠿</span>${editable}</div><div role="cell"><span class="crm-muted">${rootsForSection(section.id).length} root task${rootsForSection(section.id).length === 1 ? '' : 's'}</span></div></div>`;
        }

        function renderHeader() {
            if (!elements.projectsBoardHeader) return;
            const base = ['Task', 'Status', 'Accountable owner', 'Assignees', 'Dates'];
            const gridTemplate = [
                'minmax(300px, 2.4fr)',
                'minmax(130px, .85fr)',
                'minmax(150px, 1fr)',
                'minmax(145px, .95fr)',
                'minmax(280px, 1.35fr)',
                ...columns.map(() => 'minmax(145px, 1fr)')
            ].join(' ');
            elements.projectsBoardTable?.style.setProperty('--crm-project-grid-template', gridTemplate);
            elements.projectsBoardTable?.style.setProperty('--crm-project-column-count', String(columns.length));
            const minimumWidth = 300 + 130 + 150 + 145 + 280 + (columns.length * 145);
            if (elements.projectsBoardTable) elements.projectsBoardTable.style.minWidth = `${minimumWidth}px`;
            elements.projectsBoardHeader.innerHTML = base.concat(columns.map((column) => column.label || column.id)).map((label, index) => `<div role="columnheader"${index >= 5 && canSchema() ? ' class="crm-projects-board-column-editable"' : ''}${index >= 5 && canSchema() && !busy ? ` draggable="true" data-column-id="${escape(columns[index - 5].id)}"` : ''}><span class="crm-projects-board-column-label" title="${escape(label)}">${escape(label)}</span>${index >= 5 && canSchema() ? `<button type="button" data-action="edit-column" data-column-id="${escape(columns[index - 5].id)}" aria-label="Edit column ${escape(label)}"${busy ? ' disabled' : ''}>Edit column</button>` : ''}</div>`).join('');
        }

        function rowMarkup(row) { return row.kind === 'section' ? sectionRowMarkup(row) : taskRowMarkup(row); }

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
        function syncFocusedSelectionCell(cell, freshCell, checkbox) {
            const nextCheckbox = freshCell?.querySelector('[data-action="select-task"]');
            if (!cell || !nextCheckbox || !cell.contains(checkbox)) return false;
            // Keep the focused checkbox attached. Refresh its surroundings so
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
                node.querySelector('.crm-projects-board-task-title')?.prepend(next.cloneNode(true));
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
            ['type', 'data-action', 'aria-label', 'aria-expanded'].forEach((attribute) => {
                if (next.hasAttribute(attribute)) current.setAttribute(attribute, next.getAttribute(attribute));
                else current.removeAttribute(attribute);
            });
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
            syncSelectionCheckbox(node, fresh);
            if (interactionPinned && activeElement?.dataset?.action !== 'select-task') {
                syncPinnedExpander(node, fresh);
                return;
            }
            const focusedCell = (activeElement?.classList?.contains('crm-board-field') || activeElement?.dataset?.action === 'select-task')
                ? activeElement.closest?.('[role="cell"]')
                : null;
            const cells = Array.from(node.children);
            const freshCells = Array.from(fresh.children || []);
            const cellCount = Math.max(cells.length, freshCells.length);
            for (let index = 0; index < cellCount; index += 1) {
                const cell = cells[index];
                const freshCell = freshCells[index];
                if (cell && cell === focusedCell && activeElement?.dataset?.action === 'select-task' && syncFocusedSelectionCell(cell, freshCell, activeElement)) continue;
                if (cell && cell === focusedCell && canPreserveFocusedEditor(cell, freshCell, activeElement)) continue;
                if (cell && freshCell) cell.replaceWith(freshCell);
                else if (freshCell) node.appendChild(freshCell);
                else if (cell) cell.remove();
            }
            syncFocusedControl(node, row);
        }

        function renderVirtualRows({ viewportOnly = false } = {}) {
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
            const pinnedIds = new Set([activeRowId, sourceRowId, dragHoverTargetRowId].filter(Boolean));
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
                }
                if (!node.dataset.crmFocusBound) {
                    node.dataset.crmFocusBound = 'true';
                    node.addEventListener('focus', () => { focusedRowId = node.dataset.rowId || ''; });
                }
            });
        }

        function renderDetail() {
            const detail = elements.projectsBoardDetail;
            const task = taskFor(selectedTaskId);
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
            if (elements.projectsBoardDetailBody) elements.projectsBoardDetailBody.innerHTML = `<dl><dt>Task ID</dt><dd>${escape(task.id)}</dd></dl><dl><dt>Parent path</dt><dd>${escape(path)}</dd></dl><dl><dt>Revision</dt><dd>${escape(task.revision || 0)}</dd></dl><dl><dt>Lifecycle</dt><dd>${escape(task.effectiveLifecycle || task.lifecycle || 'active')}</dd></dl>`;
            const discussion = globalScope.CrmProjectsDiscussion;
            if (discussion && typeof discussion.setSelection === 'function') discussion.setSelection({
                projectId: currentProjectId(),
                taskId: task.id,
                taskRevision: Number(task.revision || 0),
                role: role(),
                lifecycle: task.effectiveLifecycle || task.lifecycle || 'active'
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

        function renderBoard() {
            deps.onContextChanged?.(contextSnapshot());
            if (!hasProject()) return;
            globalScope.CrmProjectsRecovery?.setSelection({ projectId: currentProjectId(), role: role(), lifecycle: project?.lifecycle || 'active' });
            if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = (project?.lifecycle || 'active') !== 'active';
            if ((project?.lifecycle || 'active') !== 'active') { globalScope.CrmProjectsDiscussion?.setSelection(null); return; }
            if (elements.projectsBoardEmpty) elements.projectsBoardEmpty.hidden = true;
            renderHeader();
            renderVirtualRows();
            renderDetail();
            renderSettings();
            syncSectionForm();
            if (elements.projectsBoardCount) elements.projectsBoardCount.textContent = `${tasks.size} loaded · ${sections.length} section${sections.length === 1 ? '' : 's'}`;
        }

        function queueRender() {
            if (renderQueued) return;
            renderQueued = true;
            requestAnimationFrame(() => { renderQueued = false; renderBoard(); });
        }

        async function requestMutation(path, payload, options = {}) {
            const body = { ...payload };
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
            if (control.multiple) return Array.from(control.selectedOptions).map((option) => option.value).filter(Boolean);
            if (control.type === 'number') return control.value === '' ? null : Number(control.value);
            return control.value === '' ? null : control.value;
        }

        async function saveTaskField(taskId, kind, control) {
            const value = fieldValue(control);
            const mutationScope = captureScope();
            const mutationProjectId = mutationScope.projectId;
            const key = kind === 'value' ? `value:${control.dataset.columnId}` : kind;
            const keyForDraft = draftKeyFor(taskId, key);
            if (!draftBases.has(keyForDraft)) draftBases.set(keyForDraft, Number(taskFor(taskId)?.revision || 0));
            const baseRevision = draftBases.get(keyForDraft);
            drafts.set(keyForDraft, value);
            const draftVersion = (draftVersions.get(keyForDraft) || 0) + 1;
            draftVersions.set(keyForDraft, draftVersion);
            return enqueueTaskMutation(taskId, async () => {
                if (!scopeIsCurrent(mutationScope)) return;
                const task = taskFor(taskId);
                if (!task || !canWrite()) return;
                const patch = kind === 'value' ? { values: { [control.dataset.columnId]: value } } : { [kind]: value };
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
                        operationId: opId, expectedRevision: baseRevision, ...patch
                    }, { method: 'PATCH' });
                    if (!scopeIsCurrent(mutationScope)) return;
                    const saved = response?.task || response?.result?.task;
                    if (taskFor(taskId) && saved && Number(saved.revision) >= Number(taskFor(taskId).revision || 0)) tasks.set(taskId, { ...taskFor(taskId), ...saved });
                    if (draftVersions.get(keyForDraft) === draftVersion) {
                        drafts.delete(keyForDraft);
                        draftVersions.delete(keyForDraft);
                        draftBases.delete(keyForDraft);
                    }
                    setStatus('Task saved.');
                    deps.onTaskMutation?.();
                } catch (error) {
                    if (!scopeIsCurrent(mutationScope)) return;
                    if (tasks.get(taskId) === next) tasks.set(taskId, previous);
                    setStatus(error?.message || 'Task save failed. Your draft is retained.', 'error');
                    if (Number(error?.status) === 409 && elements.projectsBoardStatus) {
                        const review = document.createElement('button'); review.type = 'button'; review.className = 'crm-btn-secondary crm-btn-sm'; review.textContent = 'Review and retry'; review.dataset.remoteConflictReview = taskId;
                        review.addEventListener('click', async () => {
                            review.disabled = true;
                            try {
                                const latest = await apiFetchJson(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}`);
                                if (!scopeIsCurrent(mutationScope) || !canWrite() || !latest?.task) return;
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
            if (!canSchema()) return;
            const mutationScope = captureScope();
            const mutationProjectId = mutationScope.projectId;
            const section = sections.find((entry) => String(entry.id) === String(sectionId));
            const title = String(control.value || '').trim();
            if (!section || !title || title === section.title) { if (section) control.value = section.title; return; }
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/sections/${encodeURIComponent(sectionId)}`, { operationId: operationId('section-edit'), expectedRevision: section.revision, expectedStructureRevision: structureRevision(), title }, { method: 'PATCH' });
                if (!scopeIsCurrent(mutationScope)) return;
                const updated = response?.section || response?.result?.section;
                if (updated) sections = sections.map((entry) => String(entry.id) === String(sectionId) ? { ...entry, ...updated } : entry).sort(rankCompare);
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                renderBoard();
            } catch (error) {
                if (!scopeIsCurrent(mutationScope)) return;
                control.value = section.title;
                setStatus(error?.message || 'Section could not be renamed.', 'error');
            }
        }

        async function createProject() {
            if (!apiFetchJson || !elements.projectsBoardProjectName) return;
            const name = String(elements.projectsBoardProjectName.value || '').trim();
            if (!name) { showToast('Enter a project name.', 'error'); return; }
            const creationScope = captureScope();
            try {
                const response = await requestMutation('/api/projects/', { operationId: operationId('project-create'), name, description: String(elements.projectsBoardProjectDescription?.value || '') }, { retries: 0 });
                const created = response?.project || response?.result?.project;
                if (elements.projectsBoardCreateProject) elements.projectsBoardCreateProject.hidden = true;
                if (elements.projectsBoardProjectName) elements.projectsBoardProjectName.value = '';
                if (elements.projectsBoardProjectDescription) elements.projectsBoardProjectDescription.value = '';
                const refreshed = await refreshProjects();
                if (created?.id && refreshed !== false && scopeIsCurrent(creationScope)) await selectProject(created.id);
                showToast('Project created.', 'success');
            } catch (error) { showToast(error?.message || 'Project could not be created.', 'error'); }
        }

        async function createSection() {
            if (!canSchema() || busy || sectionCreatePending) return;
            const title = String(elements.projectsBoardSectionName?.value || '').trim();
            if (!title) {
                setStatus('Enter a section name.', 'error');
                elements.projectsBoardSectionName?.focus();
                return;
            }
            const scope = captureScope();
            sectionCreatePending = true;
            syncSectionForm();
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/sections`, { operationId: operationId('section-create'), title, index: sections.length, expectedStructureRevision: structureRevision() });
                if (!scopeIsCurrent(scope)) return;
                const created = response?.section || response?.result?.section;
                if (created) sections.push(created);
                sections.sort(rankCompare);
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                renderBoard();
            } catch (error) {
                if (scopeIsCurrent(scope)) setStatus(error?.message || 'Section could not be created.', 'error');
            } finally {
                sectionCreatePending = false;
                if (scopeIsCurrent(scope)) resetSectionForm();
                else syncSectionForm();
            }
        }

        async function createTask(parentTaskId = null) {
            if (!canWrite()) return;
            const scope = captureScope();
            const sectionId = parentTaskId ? (taskFor(parentTaskId)?.effectiveSectionId || taskFor(parentTaskId)?.sectionId) : (taskFor(selectedTaskId)?.effectiveSectionId || taskFor(selectedTaskId)?.sectionId || sections[0]?.id);
            if (!sectionId) { showToast('Create a section before adding tasks.', 'error'); return; }
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/tasks`, { operationId: operationId('task-create'), title: 'New task', parentTaskId: parentTaskId || null, sectionId, index: parentTaskId ? childrenOf(parentTaskId).length : rootsForSection(sectionId).length, expectedStructureRevision: structureRevision() });
                if (!scopeIsCurrent(scope)) return;
                const created = response?.task || response?.result?.task;
                if (created) {
                    tasks.set(String(created.id), created);
                    boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                    if (parentTaskId) expanded.add(String(parentTaskId));
                    selectedTaskId = String(created.id);
                }
                renderBoard();
                elements.projectsBoardRows?.querySelector(`[data-task-id="${CSS.escape(selectedTaskId)}"]`)?.focus?.();
            } catch (error) { if (scopeIsCurrent(scope)) showToast(error?.message || 'Task could not be created.', 'error'); }
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
            const mutationScope = captureScope();
            await waitForTaskQueue(mutationScope, taskId);
            if (!scopeIsCurrent(mutationScope)) return;
            const task = taskFor(taskId);
            if (!task || !canWrite()) return;
            if (isTaskMoveNoop(task, destination)) return;
            const mutationProjectId = mutationScope.projectId;
            const opId = operationId(`move-${taskId}`);
            const operationPendingKey = pendingKeyFor(mutationScope, taskId);
            const view = snapshotView();
            let moveSucceeded = false;
            movePending.add(operationPendingKey);
            pending.set(operationPendingKey, opId);
            renderBoard();
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}/move`, { operationId: opId, expectedRevision: task.revision, expectedStructureRevision: structureRevision(), parentTaskId: destination.parentTaskId || null, sectionId: destination.sectionId || null, index: destination.index });
                if (!scopeIsCurrent(mutationScope)) return;
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                expandDestinationAncestry(destination);
                selectedTaskId = String(taskId);
                moveSucceeded = true;
                await loadProject(mutationProjectId, { preserve: true });
            } catch (error) {
                if (!scopeIsCurrent(mutationScope)) return;
                setStatus(error?.message || 'Move conflicted; refresh and retry.', 'error');
            } finally {
                if (pending.get(operationPendingKey) === opId) pending.delete(operationPendingKey);
                movePending.delete(operationPendingKey);
                if (scopeIsCurrent(mutationScope)) {
                    renderBoard();
                    if (moveSucceeded) {
                        const target = elements.projectsBoardRows?.querySelector(`[data-task-id="${CSS.escape(String(taskId))}"]`);
                        if (target) {
                            focusedRowId = target.dataset.rowId || focusedRowId;
                            target.focus?.();
                        } else {
                            restoreView(view);
                        }
                    } else {
                        restoreView(view);
                    }
                }
            }
        }

        async function moveSection(sectionId, index) {
            if (!canSchema()) return;
            const section = sections.find((entry) => String(entry.id) === String(sectionId));
            if (!section) return;
            const destinationIndex = normalizedInsertionIndex(index, Math.max(0, sections.length - 1));
            const currentIndex = sourceExcludedInsertionIndex(sections, sectionId);
            if (destinationIndex !== null && currentIndex !== null && destinationIndex === currentIndex) return;
            const scope = captureScope();
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/sections/${encodeURIComponent(sectionId)}/move`, { operationId: operationId('section-move'), expectedRevision: section.revision, expectedStructureRevision: structureRevision(), index });
                if (!scopeIsCurrent(scope)) return;
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                await loadProject(scope.projectId, { preserve: true });
            } catch (error) { if (scopeIsCurrent(scope)) setStatus(error?.message || 'Section move conflicted; refresh and retry.', 'error'); }
        }

        async function moveColumn(columnId, index) {
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
                await loadProject(scope.projectId, { preserve: true });
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
            if (!task || !canWrite()) return;
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
            if (event.target.closest('[data-action="select-task"]')) { event.preventDefault(); return; }
            if (!canWrite()) { event.preventDefault(); return; }
            const row = event.target.closest('[data-row-kind]');
            if (!row) return;
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
            if (!target) return;
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
            if (!dragState || dragState.handled) return;
            event.preventDefault();
            const target = event.target.closest('[data-row-kind]');
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

        function onBoardClick(event) {
            const row = event.target.closest('[data-row-id]');
            const action = event.target.closest('[data-action]')?.dataset?.action;
            if (action === 'select-task' && row) { event.stopPropagation(); toggleSelection(row.dataset.taskId); event.target.checked = selectedTaskIds.includes(row.dataset.taskId); return; }
            if (action === 'toggle-task' && row) { toggleTask(row.dataset.taskId); return; }
            if (action === 'drag-handle') return;
            if (row?.dataset?.rowKind === 'task') { selectedTaskId = row.dataset.taskId; focusedRowId = row.dataset.rowId; renderDetail(); renderVirtualRows(); }
        }

        function onBoardChange(event) {
            const control = event.target.closest('.crm-board-field');
            const row = control?.closest('[data-task-id]');
            if (control && row) saveTaskField(row.dataset.taskId, control.dataset.fieldKind, control);
            const sectionInput = event.target.closest('.crm-board-section-input');
            if (sectionInput) saveSection(sectionInput.closest('[data-section-id]')?.dataset?.sectionId, sectionInput);
        }

        function onBoardInput(event) {
            const control = event.target.closest('.crm-board-field');
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
            return await loadProject(currentProjectId(), { preserve: true });
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
            document.getElementById('btn-projects-board-add-task')?.addEventListener('click', () => createTask(selectedTaskId || null));
            document.getElementById('btn-projects-board-add-column')?.addEventListener('click', () => openColumnForm());
            document.getElementById('btn-projects-board-save-column')?.addEventListener('click', createColumn);
            document.getElementById('btn-projects-board-cancel-column')?.addEventListener('click', () => { if (!columnEditor?.pending) resetColumnForm(); });
            document.getElementById('btn-projects-board-save-settings')?.addEventListener('click', saveSettings);
            document.getElementById('btn-projects-board-close-detail')?.addEventListener('click', () => { selectedTaskId = ''; renderDetail(); });
            elements.projectsBoardScroll?.addEventListener('scroll', () => renderVirtualRows({ viewportOnly: true }), { passive: true });
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
            const hasChanges = change.changes.length > 0;
            const aggregateChange = change.changes.some(item => item.aggregates);
            const selectedAggregateChange = aggregateChange && selectedTaskId && change.hydration.tasks.some(task => asArray(task.ancestorIds).includes(selectedTaskId));
            if (change.refresh || structureChanged || schemaChanged || lifecycleChanged || membershipChanged || selectedAggregateChange || (hasChanges && Object.keys(sharedFilters).length)) {
                // Exceptional structural/schema/filtered reconciliation retains
                // loaded expansion, drafts and view. Ordinary fields stay below.
                const ok = await loadProject(currentProjectId(), { preserve: true, fenced: true });
                if (!ok || !change.isCurrent()) return false;
            } else {
                const removed = new Set(change.hydration.unavailableTaskIds);
                for (const [taskId, task] of tasks) if (removed.has(taskId) || asArray(task.ancestorIds).some(id => removed.has(id))) tasks.delete(taskId);
                for (const task of change.hydration.tasks) {
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
            setFilters: (filters) => { sharedFilters = { ...filters }; filterGeneration++; if (currentProjectId()) { authorityPending = true; setBusy(true); } return refresh(); },
            selectTask: (task) => { if (!task?.id || !hasProject()) return; tasks.set(String(task.id), task); asArray(task.pathIds).filter((id) => id !== task.id).forEach((id) => expanded.add(String(id))); selectedTaskId = String(task.id); renderDetail(); renderVirtualRows(); },
            getState: contextSnapshot };
    }

    globalScope.CrmProjectsBoard = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
