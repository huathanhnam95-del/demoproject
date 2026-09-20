(function (globalScope) {
    'use strict';

    const STATUS_KEYS = ['not_started', 'in_progress', 'blocked', 'done'];
    const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
    const PRIORITY_KEYS = ['none', 'low', 'medium', 'high', 'urgent'];
    const PRIORITY_LABELS = { none: 'None', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
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
        let ROW_HEIGHT = 44;
        const elements = deps.elements || {};
        let presentationV2 = deps.presentationV2 === true, tableLayout = null, visibleColumns = [];
        const columnModel = globalScope.CrmProjectsColumnsV2;
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
        const feedbackStore = presentationV2 ? globalScope.CrmProjectsFieldFeedbackV2?.createStore() : null;
        let renameSession = null, rowEditor = null;
        let mobileList = false, mobileLimit = 50, mobileProject = '', layoutObserver = null, mobileMore = null, mobilePrevious = null;
        const MOBILE_WINDOW = 200;
        function availableRows() { return mobileList ? logicalRows.slice(0, mobileLimit) : logicalRows; }
        function focusNavigationRow(id) {
            const row = availableRows().find(row => row.id === id);
            if (!row) return;
            focusedRowId = id;
            if (!mobileList) elements.projectsBoardScroll.scrollTop = row.index * ROW_HEIGHT;
            renderVirtualRows({ focusRowId: id });
            const node = elements.projectsBoardRows.querySelector(`[data-row-id="${cssEscape(id)}"]`);
            node?.focus({ preventScroll: true });
            if (mobileList) node?.scrollIntoView?.({ block: 'nearest' });
        }
        function rowNavigationStops() {
            if (!presentationV2) return;
            const rows = Array.from(elements.projectsBoardRows.querySelectorAll('[data-row-id]'));
            if (!availableRows().some(row => row.id === focusedRowId)) focusedRowId = availableRows().find(row => row.kind !== 'summary')?.id || '';
            rows.forEach(node => {
                const active = node.dataset.rowId === focusedRowId;
                node.tabIndex = active ? 0 : -1;
                node.querySelectorAll('button, input, select, a[href]').forEach(control => {
                    // Hidden canonical controls are never additional tab stops.
                    const hidden = control.matches('.crm-board-status-select, .crm-board-people-field') || control.matches('select') && control.previousElementSibling?.matches('.crm-people-trigger');
                    control.tabIndex = (active || node.dataset.rowKind === 'summary') && !hidden ? 0 : -1;
                });
            });
        }
        function syncListSemantics() {
            if (!presentationV2) return;
            const table = elements.projectsBoardTable, rows = elements.projectsBoardRows;
            table.dataset.presentation = mobileList ? 'list' : 'table';
            table.setAttribute('role', mobileList ? 'presentation' : 'table');
            rows.setAttribute('role', mobileList ? 'list' : 'rowgroup');
            if (mobileList) { rows.setAttribute('aria-label', 'Project tasks and groups'); table.removeAttribute('aria-rowcount'); table.removeAttribute('aria-colcount'); }
            else { rows.removeAttribute('aria-label'); table.setAttribute('aria-rowcount', String(logicalRows.length + 1)); table.setAttribute('aria-colcount', String(visibleColumns.length)); }
            elements.projectsBoardHeader.hidden = mobileList;
            rows.style.height = mobileList ? 'auto' : `${Math.max(logicalRows.length * ROW_HEIGHT, ROW_HEIGHT)}px`;
            rows.querySelectorAll('[data-row-id]').forEach(node => {
                const logical = logicalRows.find(row => row.id === node.dataset.rowId);
                node.setAttribute('role', mobileList ? 'listitem' : 'row');
                node.removeAttribute('aria-selected');
                if (mobileList) { node.removeAttribute('aria-rowindex'); node.setAttribute('aria-posinset', String(logical.index + 1)); node.setAttribute('aria-setsize', String(Math.min(logicalRows.length, mobileLimit))); }
                else { node.setAttribute('aria-rowindex', String(logical.index + 2)); node.removeAttribute('aria-posinset'); node.removeAttribute('aria-setsize'); }
                if (logical.task) node.setAttribute('aria-label', `${logical.task.title}. Level ${Number(logical.depth || 0) + 1}${selectedTaskIds.includes(String(logical.task.id)) ? '. Selected' : ''}`);
                Array.from(node.children).forEach((cell, index) => {
                    cell.setAttribute('role', mobileList ? 'presentation' : 'cell');
                    if (mobileList) { cell.removeAttribute('aria-colindex'); cell.removeAttribute('aria-colspan'); }
                    else if (logical.kind === 'section') cell.setAttribute('aria-colspan', String(visibleColumns.length));
                    else cell.setAttribute('aria-colindex', String(index + 1));
                });
                node.querySelector('[data-action="pick-status"]')?.setAttribute('aria-label', `Change status for ${logical.task?.title}: ${project?.statusLabels?.[effectiveField(logical.task?.id, 'status')] || STATUS_LABELS[effectiveField(logical.task?.id, 'status')] || logical.task?.status || ''}`);
                const expander = node.querySelector('.crm-board-expander');
                if (expander && mobileList) { const count = Number(logical.task.activeChildCount || logical.task.childCount || 0); expander.hidden = count === 0; expander.dataset.action = 'open-subtasks'; expander.textContent = `${count} subtasks`; expander.removeAttribute('aria-expanded'); expander.setAttribute('aria-label', `Open subtasks for ${logical.task.title}`); }
            });
            if (mobilePrevious) mobilePrevious.hidden = !mobileList || mobileLimit <= MOBILE_WINDOW;
            if (mobileMore) mobileMore.hidden = !mobileList || mobileLimit >= logicalRows.length;
            rowNavigationStops();
        }
        function syncListWidth() {
            const width = document.querySelector('[data-panel="projects"]')?.getBoundingClientRect().width;
            if (!width || !presentationV2 || mobileList === (width < 700)) return;
            mobileList = width < 700;
            // Retain the current editor and its authorized loaded prefix across a boundary.
            const active = document.activeElement?.closest('[data-row-id]');
            const index = logicalRows.findIndex(row => row.id === active?.dataset.rowId);
            if (index >= mobileLimit) mobileLimit = Math.ceil((index + 1) / 50) * 50;
            renderHeader(); renderVirtualRows();
        }
        const creationIntents = new Map(), composerDrafts = new Map();
        let quickComposer = null, batchRun = null, sectionIntent = null, quickTaskAfterSection = false;
        function clearQuickCreation() {
            quickComposer?.node.remove(); quickComposer = null; sectionCreatePending = false;
            creationIntents.clear(); composerDrafts.clear(); sectionIntent = null; quickTaskAfterSection = false; batchRun = null;
            document.querySelector?.('[data-batch-result]')?.remove();
            document.querySelector?.('[data-creation-recovery]')?.remove();
        }
        function creationFeedback(intent, phase, extra = {}) {
            intent.phase = phase;
            try { deps.onCreationEvent?.({ intentId: intent.id, scope: fieldSaveScope(intent.scope), phase, ...extra }); } catch (_) { /* observational */ }
        }
        function paintLegacyCreationRecovery() {
            const intent = !presentationV2 && canWrite() && [...creationIntents.values()].find(i => scopeIsCurrent(i.scope) && i.payload && ['uncertain', 'saving'].includes(i.phase));
            let node = document.querySelector?.('[data-creation-recovery]');
            if (!intent) { node?.remove(); return; }
            if (!node) {
                node = document.createElement('div'); node.dataset.creationRecovery = ''; node.setAttribute('role', 'status');
                elements.projectsBoardTableWrap?.before(node);
            }
            node.textContent = intent.phase === 'saving' ? 'Confirming task creation… ' : 'Task creation is unconfirmed. Retry the same creation before adding another task. ';
            const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.retryCreation = '';
            retry.textContent = 'Retry same creation'; retry.disabled = intent.phase === 'saving';
            retry.addEventListener('click', () => {
                if (creationIntents.get(intent.id) !== intent || intent.phase !== 'uncertain' || !scopeIsCurrent(intent.scope) || !canWrite()) return;
                createTask(intent.payload.parentTaskId, intent.payload.sectionId, { initialTitle: intent.payload.title, intentId: intent.id });
            });
            node.append(retry);
        }
        function settleComposerParent(temporaryIds, created, scope) {
            for (const [key, draft] of composerDrafts) {
                const [uid, projectId, , parentId] = JSON.parse(key);
                if (uid !== scope.uid || projectId !== scope.projectId || !temporaryIds.includes(parentId)) continue;
                const nextKey = JSON.stringify([uid, projectId, created.effectiveSectionId || '', String(created.id)]);
                composerDrafts.delete(key); composerDrafts.set(nextKey, draft);
                if (quickComposer?.key === key) {
                    quickComposer.key = nextKey; quickComposer.parentId = String(created.id);
                    quickComposer.node.querySelector('select').value = created.effectiveSectionId || '';
                    quickComposer.paint();
                }
            }
        }
        function openQuickComposer(parentId = null, sectionId = null) {
            if (!presentationV2) return createTask(parentId, sectionId);
            if (!canWrite() || busy) return;
            const scope = captureScope();
            if (parentId) sectionId = resolveEffectiveSectionId(parentId);
            if (!sectionId && currentGroupBy === 'section') sectionId = resolveEffectiveSectionId(selectedTaskId) || sections[0]?.id;
            const key = JSON.stringify([scope.uid, scope.projectId, sectionId || '', parentId || '']);
            if (quickComposer?.key === key) { quickComposer.input.focus(); return; }
            quickComposer?.node.remove();
            const draft = composerDrafts.get(key) || { text: '', intentId: operationId('quick') };
            composerDrafts.set(key, draft);
            const trigger = document.activeElement;
            let composing = false;
            const node = document.createElement('form'); node.dataset.quickCreate = ''; node.className = 'crm-quick-create';
            node.innerHTML = `<label>${parentId ? 'New subtask' : 'New task'}<input name="title" aria-label="${parentId ? 'Subtask' : 'Task'} title" aria-describedby="projects-quick-result" autocomplete="off"></label><label>Section<select name="section" aria-label="Task section"><option value="">Choose a section…</option>${sections.filter(s => !s.isOptimistic).map(s => `<option value="${escape(s.id)}">${escape(s.title)}</option>`).join('')}</select></label><button type="submit">Add task</button><button type="button" data-cancel-create>Cancel</button><span id="projects-quick-result" role="status"></span>`;
            const input = node.querySelector('input'), target = node.querySelector('select'), submit = node.querySelector('[type="submit"]'), status = node.querySelector('[role="status"]');
            input.value = draft.text; target.value = sectionId || ''; target.disabled = !!parentId;
            const composer = { key, parentId, node, input, scope, draft, status, paint: null }; quickComposer = composer;
            // Outside the virtual table: one stable composer, no unbounded row pinning.
            elements.projectsBoardTableWrap?.before(node);
            const paint = () => {
                const intent = creationIntents.get(draft.intentId), unresolved = intent?.phase === 'saving' || intent?.phase === 'uncertain';
                input.readOnly = !!unresolved; target.disabled = !!composer.parentId || !!unresolved;
                submit.disabled = intent?.phase === 'saving' || !canWrite();
                submit.textContent = intent?.phase === 'uncertain' ? 'Retry same creation' : 'Add task';
                node.querySelector('[data-cancel-create]').disabled = !!unresolved;
            };
            composer.paint = paint;
            input.addEventListener('compositionstart', () => { composing = true; });
            input.addEventListener('compositionend', () => { composing = false; });
            const cancel = () => { node.remove(); if (quickComposer === composer) quickComposer = null; if (scopeIsCurrent(scope) && trigger?.isConnected) trigger.focus(); };
            target.addEventListener('change', () => { draft.text = input.value; openQuickComposer(composer.parentId, target.value); });
            input.addEventListener('input', () => { draft.text = input.value; });
            node.addEventListener('keydown', e => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && e.target === input) { e.preventDefault(); node.requestSubmit(); }
                if (e.key === 'Escape' && !creationIntents.has(draft.intentId)) { e.preventDefault(); cancel(); }
            });
            node.querySelector('[data-cancel-create]').addEventListener('click', () => {
                if (creationIntents.has(draft.intentId)) return;
                cancel();
            });
            node.addEventListener('submit', async e => {
                e.preventDefault();
                if (!presentationV2 || quickComposer !== composer || composing || !scopeIsCurrent(scope) || !canWrite() || creationIntents.get(draft.intentId)?.phase === 'saving') return;
                draft.text = input.value;
                if (!target.value) { status.textContent = 'Choose a real section.'; target.focus(); return; }
                const title = input.value.trim();
                if (!title || title.length > 200) { status.textContent = 'Enter a title (up to 200 characters).'; return; }
                let moved = false;
                const track = event => { if (event.target !== document.body && !node.contains(event.target)) moved = true; };
                document.addEventListener('focusin', track); document.addEventListener('pointerdown', track);
                const promise = createTask(composer.parentId, target.value, { initialTitle: title, intentId: draft.intentId, keepComposerFocus: true });
                paint(); status.textContent = 'Saving…';
                const created = await promise;
                document.removeEventListener('focusin', track); document.removeEventListener('pointerdown', track);
                if (!scopeIsCurrent(scope)) return;
                if (created) { draft.text = ''; draft.intentId = operationId('quick'); }
                if (quickComposer?.draft !== draft) return;
                const active = quickComposer;
                const intent = creationIntents.get(draft.intentId);
                if (created) { active.input.value = ''; active.status.textContent = 'Saved'; if (active.node.contains(document.activeElement) || active === composer && !moved && document.activeElement === document.body) active.input.focus(); }
                else active.status.textContent = intent?.phase === 'uncertain' ? 'Outcome unconfirmed. Retry the same creation to reconcile.' : 'Creation failed. Your text is retained; review access and retry.';
                active.paint();
            });
            paint(); input.focus();
        }
        const branchLoading = new Set();
        let bound = false;
        let sharedFilters = {};
        const contextListeners = new Set();
        // Canonical tasks resolved from other views are not members of the loaded
        // List query until a branch response includes them.
        const projectionTaskIds = new Set();
        function publishContext(change = {}) {
            const snapshot = { ...contextSnapshot(), ...change };
            deps.onContextChanged?.(snapshot);
            contextListeners.forEach(listener => listener(snapshot));
        }
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
        let detailOpenIntent = null;
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
        // Presentation versions outlive saved draft cleanup, independently of lineage.
        const fieldUiSequences = new Map();
        function fieldSaveScope(scope = captureScope()) {
            return { actorUid: scope.uid, projectId: scope.projectId, epoch: scope.epoch };
        }
        function emitFieldSave(scope, taskId, field, editVersion, phase, extra = {}) {
            // A presentation subscriber must never fail or retry a domain write.
            try {
                const event = { scope: fieldSaveScope(scope), taskId: String(taskId), field, editVersion, phase, ...extra };
                feedbackStore?.accept(event);
                paintFieldFeedback(taskId);
                const detailFields = elements.projectsBoardDetailBody?.querySelector?.('[data-detail-fields]');
                if (detailFields?.dataset.taskId === String(taskId)) paintFieldFeedback(taskId, detailFields);
                deps.onFieldSaveEvent?.(event);
            }
            catch (_) { /* feedback is observational */ }
        }
        function dirtyField(scope, taskId, field) {
            const key = JSON.stringify([scope.uid, scope.projectId, scope.epoch, String(taskId), field]);
            const version = (fieldUiSequences.get(key) || 0) + 1;
            fieldUiSequences.set(key, version);
            emitFieldSave(scope, taskId, field, version, 'dirty');
            return version;
        }
        function resetFieldFeedback() {
            fieldUiSequences.clear();
            feedbackStore?.setScope(fieldSaveScope());
            try { deps.onFieldSaveScopeChanged?.(fieldSaveScope()); }
            catch (_) { /* feedback is observational */ }
        }
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

        const feedbackLabels = { dirty: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Not saved', conflict: 'Conflict — review', uncertain: 'Not confirmed — review', cancelled: 'Not saved' };
        function paintFieldFeedback(taskId, target = elements.projectsBoardRows?.querySelector(`[data-task-id="${cssEscape(taskId)}"]`)) {
            if (!presentationV2 || !target || !feedbackStore) return;
            for (const record of feedbackStore.getSnapshot().filter(item => item.taskId === String(taskId))) {
                const key = record.field === 'title' ? 'taskTitle' : record.field.startsWith('value:') ? `custom:${record.field.slice(6)}` : ['dates', 'startDate', 'dueDate'].includes(record.field) ? 'dates' : record.field;
                const cell = Array.from(target.children).find(node => node.dataset.columnKey === key);
                if (!cell) continue;
                let label = cell.querySelector('[data-field-feedback]');
                if (!label) { label = document.createElement('span'); label.className = 'crm-field-feedback'; label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'polite'); cell.appendChild(label); }
                label.dataset.fieldFeedback = record.field; label.dataset.phase = record.phase;
                label.textContent = record.reason === 'edit-cancelled' ? 'Edit cancelled' : feedbackLabels[record.phase];
                label.title = record.message || feedbackLabels[record.phase];
                const error = ['error', 'conflict', 'uncertain'].includes(record.phase);
                label.id = `pj-feedback-${target.closest('#projects-board-detail') ? 'detail' : 'row'}-${encodeURIComponent(taskId)}-${encodeURIComponent(record.field)}`;
                label.setAttribute('aria-atomic', 'true');
                if (error && record.message) label.textContent += `: ${record.message}`;
                cell.querySelectorAll('input, select, button').forEach(control => {
                    control.setAttribute('aria-describedby', label.id);
                    if (control.matches('input, select')) { if (error) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid'); }
                });
            }
        }
        function effectiveField(taskId, field) {
            const key = draftKeyFor(taskId, field);
            return drafts.has(key) ? drafts.get(key) : field.startsWith('value:') ? taskFor(taskId)?.values?.[field.slice(6)] : taskFor(taskId)?.[field];
        }
        function dateOnly(value) {
            if (value == null || value === '') return null;
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a date in YYYY-MM-DD format.');
            const date = new Date(`${value}T00:00:00.000Z`);
            if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid calendar date.');
            return value;
        }
        function dateRange(value) {
            const startDate = dateOnly(value.startDate), dueDate = dateOnly(value.dueDate);
            if (startDate && dueDate && startDate > dueDate) throw new Error('Start date cannot be after due date.');
            return { startDate, dueDate };
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
            if (role() !== 'Owner' || String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid || (project?.lifecycle || 'active') !== 'active') quickTaskAfterSection = false;
            const owner = canSchema();
            const disabled = busy || !owner || sectionCreatePending;
            if (elements.projectsBoardSectionName) elements.projectsBoardSectionName.disabled = disabled;
            if (elements.projectsBoardSectionName) elements.projectsBoardSectionName.readOnly = !!sectionIntent;
            if (elements.projectsBoardSaveSection) elements.projectsBoardSaveSection.disabled = disabled;
            if (elements.projectsBoardCancelSection) elements.projectsBoardCancelSection.disabled = sectionCreatePending || !!sectionIntent;
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
                if (!sectionIntent) elements.projectsBoardSectionName.value = '';
                elements.projectsBoardSectionName.focus();
            }
            syncSectionForm();
        }

        function closeSectionForm() {
            if (sectionCreatePending || sectionIntent) return;
            quickTaskAfterSection = false;
            resetSectionForm();
        }

        function startTopLevelTaskCreation() {
            if (!canWrite() || busy || sectionCreatePending) return;
            const realSections = sections.filter(section => !section.isOptimistic && (section.lifecycle || 'active') === 'active');
            if (realSections.length === 0) {
                if (!canSchema()) {
                    quickTaskAfterSection = false;
                    setStatus('Ask a project Owner to add the first section before creating a task.');
                    return;
                }
                quickTaskAfterSection = captureScope();
                openSectionForm();
                setStatus('Name the first section. Your task form will open next.');
                return;
            }
            openQuickComposer(null);
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
            publishContext();
            return next.slice();
        }
        function toggleSelection(taskId) {
            if (!selectableTask(tasks.get(taskId))) return;
            if (!selectedTaskIds.includes(taskId) && selectedTaskIds.length >= 20) { setStatus('Select at most 20 tasks.', 'error'); return; }
            setSelectedTaskIds(selectedTaskIds.includes(taskId) ? selectedTaskIds.filter(id => id !== taskId) : [...selectedTaskIds, taskId]);
            if (presentationV2) setStatus(`${selectedTaskIds.length} tasks selected.`);
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
        function paintBatchResult(run) {
            if (!scopeIsCurrent(run.scope)) return;
            let node = document.querySelector('[data-batch-result]');
            if (!node) { node = document.createElement('div'); node.dataset.batchResult = ''; node.setAttribute('role', 'status'); document.getElementById('projects-batch-dock')?.after(node); }
            const count = phase => run.items.filter(i => i.phase === phase).length;
            node.textContent = `${count('saved')} saved · ${count('conflict')} conflicts · ${count('skipped')} skipped · ${count('failed')} failed · ${count('uncertain')} unconfirmed · ${count('waiting')} waiting. `;
            const list = document.createElement('ol');
            for (const item of run.items) { const row = document.createElement('li'); row.textContent = `${item.title}: ${item.phase}${item.message ? ' — ' + item.message : ''}`; list.append(row); }
            node.append(list);
            if (!run.pending && run.items.some(i => i.phase === 'uncertain')) {
                const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry unconfirmed batch';
                retry.addEventListener('click', () => dispatchBatch(run)); node.append(retry);
            }
            const hint = document.createElement('span'); hint.textContent = 'Review project history for available Undo actions.'; node.append(hint);
        }
        async function executeV2Batch(kind, value) {
            if (!canWrite() || busy || creationIntents.size || sectionIntent || !selectedTaskIds.length || batchRun?.pending || batchRun?.items.some(i => i.phase === 'uncertain')) return;
            if (kind === 'status' && !STATUS_KEYS.includes(value)) return;
            if (kind === 'move' && !sections.some(s => s.id === value && !s.isOptimistic)) return;
            if (kind === 'archive' && !globalScope.confirm(`Archive ${selectedTaskIds.length} selected tasks and their descendants?`)) return;
            const run = { scope: captureScope(), kind, value, pending: false, items: selectedTaskIds.map(id => ({ id, title: taskFor(id)?.title || id, phase: 'waiting', revision: taskFor(id)?.revision, request: null })) };
            batchRun = run;
            await dispatchBatch(run);
        }
        async function dispatchBatch(run) {
            if (run !== batchRun || run.pending || !scopeIsCurrent(run.scope) || !canWrite()) return;
            run.pending = true; setBusy(true);
            let stopped = false;
            try {
                for (const item of run.items) {
                    if (!scopeIsCurrent(run.scope)) return;
                    if (item.phase === 'saved' || item.phase === 'skipped' || item.phase === 'conflict' || item.phase === 'failed') continue;
                    if (stopped) { item.phase = 'waiting'; continue; }
                    if (!canWrite()) { item.phase = 'failed'; item.message = 'Permission no longer available'; stopped = true; continue; }
                    const task = taskFor(item.id);
                    if (!item.request && (!selectableTask(task) || task.isOptimistic)) { item.phase = 'skipped'; continue; }
                    if (!item.request && task.revision !== item.revision) { item.phase = 'conflict'; continue; }
                    if (!item.request && run.kind === 'move' && !task.parentTaskId && resolveEffectiveSectionId(item.id) === run.value) { item.phase = 'skipped'; continue; }
                    if (!item.request) {
                        const base = `/api/projects/${encodeURIComponent(run.scope.projectId)}/tasks`;
                        const operation = operationId(`batch-${run.kind}`);
                        if (run.kind === 'status') item.request = { path: `${base}/bulk`, body: { operationId: operation, changes: [{ taskId: item.id, expectedRevision: task.revision, patch: { status: run.value } }] } };
                        else item.request = { path: `${base}/${encodeURIComponent(item.id)}/${run.kind}`, body: { operationId: operation, expectedRevision: task.revision, expectedStructureRevision: structureRevision(), ...(run.kind === 'move' ? { parentTaskId: null, sectionId: run.value, index: rootsForSection(run.value).length } : {}) } };
                    }
                    try {
                        const response = await requestMutation(item.request.path, item.request.body, { scope: run.scope });
                        if (!scopeIsCurrent(run.scope)) return;
                        if (!canWrite()) throw Object.assign(new Error('Permission changed before acknowledgement.'), { status: 403 });
                        const result = response?.result || response;
                        if (run.kind === 'status') {
                            const saved = result?.updated?.find(t => t.taskId === item.id);
                            if (!saved || !Number.isFinite(Number(saved.revision))) throw new Error('Unconfirmed acknowledgement');
                            const current = taskFor(item.id);
                            if (current && Number(current.revision) <= Number(saved.revision)) tasks.set(item.id, { ...current, status: run.value, revision: saved.revision });
                        } else if (run.kind === 'move') {
                            if (result?.task?.id !== item.id || !Number.isFinite(Number(result.task.revision)) || !Number.isFinite(Number(result.structureRevision))) throw new Error('Unconfirmed acknowledgement');
                            reconcileTaskMove(item.id, item.request.body, result);
                        } else {
                            if (result?.targetId !== item.id || result.lifecycle !== 'archived' || !Number.isFinite(Number(result.structureRevision))) throw new Error('Unconfirmed acknowledgement');
                            boardRevision.structureRevision = Math.max(structureRevision(), Number(result.structureRevision));
                            const acknowledged = result.affected?.find(row => row.type === 'task' && row.id === item.id);
                            if (acknowledged && Number(taskFor(item.id)?.revision || 0) <= Number(acknowledged.revision)) {
                                for (const [id, row] of tasks) if (id === item.id || (row.ancestorIds || []).includes(item.id)) tasks.delete(id);
                            }
                        }
                        item.phase = 'saved';
                        setSelectedTaskIds(selectedTaskIds.filter(id => id !== item.id));
                        invalidateHierarchy();
                    } catch (error) {
                        if (!scopeIsCurrent(run.scope)) return;
                        item.phase = !error?.status || Number(error.status) >= 500 ? 'uncertain' : Number(error.status) === 409 ? 'conflict' : 'failed';
                        item.message = error.message;
                        // A structural conflict or unconfirmed write invalidates the remaining revision chain.
                        stopped = item.phase === 'uncertain' || run.kind !== 'status' || [401, 403].includes(Number(error.status));
                    }
                }
            } finally {
                run.pending = false;
                if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) invalidateAccess(currentProjectId());
                else if (scopeIsCurrent(run.scope)) {
                    setBusy(false); renderBoard(); paintBatchResult(run);
                    for (const id of ['projects-batch-status', 'projects-batch-section']) { const control = document.getElementById(id); if (control) control.value = ''; }
                }
            }
        }
        async function executeBatchStatus(newStatus) {
            if (presentationV2) return executeV2Batch('status', newStatus);
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
                if (!scopeIsCurrent(mutationScope)) return;
                taskIdsToUpdate.forEach((id) => {
                    const t = taskFor(id);
                    if (t) tasks.set(id, { ...t, status: newStatus });
                });
                invalidateHierarchy();
                showToast(`Updated status for ${taskIdsToUpdate.length} task${taskIdsToUpdate.length === 1 ? '' : 's'}.`, 'success');
                renderBoard();
            } catch (err) {
                if (scopeIsCurrent(mutationScope)) showToast(err?.message || 'Batch status update failed.', 'error');
            } finally {
                if (scopeIsCurrent(mutationScope)) {
                    setBusy(false);
                    const statusSelect = document.getElementById('projects-batch-status');
                    if (statusSelect) statusSelect.value = '';
                }
            }
        }
        async function executeBatchSection(targetSectionId) {
            if (presentationV2) return executeV2Batch('move', targetSectionId);
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
            let successCount = 0;
            let skippedCount = 0;
            let lastError = null;
            try {
                for (const id of taskIdsToMove) {
                    if (!scopeIsCurrent(mutationScope)) return;
                    const t = taskFor(id);
                    if (!t) {
                        skippedCount++;
                        continue;
                    }
                    if ((t.effectiveSectionId || t.sectionId) === resolvedTargetId && !t.parentTaskId) {
                        skippedCount++;
                        continue;
                    }
                    try {
                        const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationScope.projectId)}/tasks/${encodeURIComponent(id)}/move`, {
                            operationId: operationId(`batch-move-${id}`),
                            expectedRevision: t.revision,
                            expectedStructureRevision: structureRevision(),
                            parentTaskId: null,
                            sectionId: resolvedTargetId,
                            index: rootsForSection(resolvedTargetId).length
                        });
                        if (!scopeIsCurrent(mutationScope)) return;
                        const movedTask = response?.task || response?.result?.task;
                        const updatedStructure = response?.structureRevision ?? response?.result?.structureRevision;
                        if (updatedStructure !== undefined) {
                            boardRevision.structureRevision = Math.max(structureRevision(), Number(updatedStructure));
                        }
                        if (movedTask) {
                            const oldParentId = t.parentTaskId;
                            if (oldParentId) {
                                const oldParent = taskFor(oldParentId);
                                if (oldParent && Number(oldParent.activeChildCount) > 0) oldParent.activeChildCount -= 1;
                            }
                            const updatedEffectiveSection = resolvedTargetId;
                            const updatedTask = {
                                ...t,
                                ...movedTask,
                                sectionId: resolvedTargetId,
                                effectiveSectionId: updatedEffectiveSection,
                                parentTaskId: null,
                                ancestorIds: [],
                                pathIds: [id]
                            };
                            tasks.set(id, updatedTask);
                            const updateDescendants = (parentId, parentPath) => {
                                for (const [childId, child] of tasks.entries()) {
                                    if (child.parentTaskId === parentId) {
                                        const childPath = [...parentPath, childId];
                                        tasks.set(childId, {
                                            ...child,
                                            effectiveSectionId: updatedEffectiveSection,
                                            ancestorIds: parentPath,
                                            pathIds: childPath
                                        });
                                        updateDescendants(childId, childPath);
                                    }
                                }
                            };
                            updateDescendants(id, [id]);
                            invalidateHierarchy();
                        }
                        successCount++;
                    } catch (itemErr) {
                        lastError = itemErr;
                        break;
                    }
                }
                if (!scopeIsCurrent(mutationScope)) return;
                if (successCount > 0 && !lastError) {
                    showToast(`Moved ${successCount} task${successCount === 1 ? '' : 's'} to section.`, 'success');
                } else if (successCount > 0 && lastError) {
                    showToast(`Moved ${successCount} task${successCount === 1 ? '' : 's'}; remaining moves stopped due to error: ${lastError.message}`, 'warning');
                } else if (lastError) {
                    showToast(lastError.message || 'Batch section move failed.', 'error');
                }
                renderBoard();
            } catch (err) {
                if (scopeIsCurrent(mutationScope)) showToast(err?.message || 'Batch section move failed.', 'error');
            } finally {
                if (scopeIsCurrent(mutationScope)) {
                    setBusy(false);
                    const sectionSelect = document.getElementById('projects-batch-section');
                    if (sectionSelect) sectionSelect.value = '';
                }
            }
        }
        async function executeBatchDelete() {
            if (presentationV2) return executeV2Batch('archive');
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
                if (!scopeIsCurrent(mutationScope)) return;
                taskIdsToArchive.forEach((id) => tasks.delete(id));
                invalidateHierarchy();
                selectedTaskIds = [];
                renderBatchDock();
                showToast(`Archived ${taskIdsToArchive.length} task${taskIdsToArchive.length === 1 ? '' : 's'}.`, 'success');
                renderBoard();
            } catch (err) {
                if (scopeIsCurrent(mutationScope)) showToast(err?.message || 'Batch archive failed.', 'error');
            } finally {
                if (scopeIsCurrent(mutationScope)) {
                    setBusy(false);
                }
            }
        }
        let cachedContextTasks = null;
        let contextTasksVersion = -1;
        let contextTasksSource = null;
        let contextTasksEpoch = -1;
        function contextSnapshot() {
            if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) { if (project || tasks.size) invalidateAccess(currentProjectId()); resetColumnForm(); selectedTaskIds = []; stateModel?.setSelectedTaskIds?.([]); }
            // Loads replace the task map before publishing authority, and that
            // publication can precede renderBoard's hierarchy invalidation.
            // Never pair a new project's identity with the previous map's cache.
            if (contextTasksSource !== tasks || contextTasksEpoch !== projectEpoch || contextTasksVersion !== tasksVersion || !cachedContextTasks) {
                cachedContextTasks = new Map(tasks);
                contextTasksVersion = tasksVersion;
                contextTasksSource = tasks;
                contextTasksEpoch = projectEpoch;
            }
            return { project, actorUid: controllerActorUid, authorityPending, authorizationReady: !authorityPending && hasProject() && !refreshRequested(), filterOptionsReady: !!project && !busy && !authorityPending, authorityRevision, membership, members: members.slice(), sections: sections.slice(), columns: columns.slice(), tasks: cachedContextTasks, selectedTaskId, selectedTaskIds: selectedTaskIds.slice(), filters: { ...sharedFilters }, mutationPending: [...pending.keys()].some(key => { const [id, epoch] = JSON.parse(key); return id === currentProjectId() && epoch === projectEpoch; }) };
        }

        function syncTaskCreation() {
            paintLegacyCreationRecovery();
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
            publishContext();
        }

        let suspendedTableEdit = null;
        function clearSuspendedTableEdit() {
            if (!suspendedTableEdit) return;
            document.removeEventListener('focusin', suspendedTableEdit.onFocus, true);
            document.removeEventListener('pointerdown', clearSuspendedTableEdit, true);
            suspendedTableEdit = null;
        }
        function currentSuspendedTableEdit() {
            const edit = suspendedTableEdit;
            if (edit && (!scopeIsCurrent(edit.scope) || edit.filterGeneration !== filterGeneration
                || !canRenderTaskEditor() || !edit.active.isConnected)) clearSuspendedTableEdit();
            return suspendedTableEdit;
        }
        // Views owns the stale-projection fence; Board owns its native editor.
        // Hiding an ancestor blurs Chrome's active input before the async loader
        // can snapshot it. Retain only a dirty editor across that temporary fence.
        function setTableVisibility(hidden, { preserveFocus = false } = {}) {
            const table = elements.projectsBoardTableWrap;
            if (!table) return;
            if (!preserveFocus) clearSuspendedTableEdit();
            if (hidden && preserveFocus && !table.hidden && !currentSuspendedTableEdit()) {
                const active = document.activeElement;
                const taskId = active?.closest?.('[data-task-id]')?.dataset.taskId;
                const kind = active?.dataset?.fieldKind;
                const field = kind === 'value' ? `value:${active.dataset.columnId}` : kind;
                if (table.contains(active) && active?.classList?.contains('crm-board-field')
                    && taskId && field && drafts.has(draftKeyFor(taskId, field)) && canRenderTaskEditor()) {
                    const edit = { active, view: snapshotView(), scope: captureScope(), filterGeneration,
                        onFocus: event => { if (event.target !== active) clearSuspendedTableEdit(); } };
                    suspendedTableEdit = edit;
                    document.addEventListener('focusin', edit.onFocus, true);
                    document.addEventListener('pointerdown', clearSuspendedTableEdit, true);
                }
            }
            table.hidden = hidden;
            const edit = currentSuspendedTableEdit();
            if (!hidden && edit && !busy && canWrite()) {
                clearSuspendedTableEdit();
                if (!edit.active.disabled && !edit.active.readOnly) restoreView(edit.view);
            }
        }

        function snapshotView() {
            const suspended = currentSuspendedTableEdit();
            if (suspended) return suspended.view;
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
                detailFocus: presentationV2 && !!active?.closest?.('#projects-board-detail'),
                activeId: row?.dataset?.rowId || focusedRowId,
                controlId: active?.id || '',
                taskId: taskRow?.dataset?.taskId || '',
                sectionId: sectionRow?.dataset?.sectionId || '',
                fieldKind: active?.dataset?.fieldKind || '',
                action: typeof presentationV2 !== 'undefined' && presentationV2 ? active?.dataset?.action || '' : '',
                columnKey: active?.closest?.('[data-column-key]')?.dataset?.columnKey || '',
                selectionControl: active?.dataset?.action === 'select-task',
                columnId: active?.dataset?.columnId || '',
                selectionStart: typeof active?.selectionStart === 'number' ? active.selectionStart : null,
                selectionEnd: typeof active?.selectionEnd === 'number' ? active.selectionEnd : null,
                selectionDirection: active?.selectionDirection || 'none'
            };
        }

        function restoreView(view) {
            if (!view) return;
            if (view.taskId && !view.detailFocus && elements.projectsBoardTableWrap?.hidden) return;
            const safeCss = (val) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
                ? CSS.escape(val)
                : (typeof cssEscape === 'function' ? cssEscape(val) : String(val ?? '').replace(/["\\]/g, '\\$&'));
            if (elements.projectsBoardScroll) elements.projectsBoardScroll.scrollTop = view.scrollTop || 0;
            if (elements.projectsBoardScroll) elements.projectsBoardScroll.scrollLeft = view.scrollLeft || 0;
            if (view.externalFocus) return;
            if (view.detailFocus && !elements.projectsBoardDetail?.open) return;
            const focusHost = view.detailFocus ? elements.projectsBoardDetailBody : elements.projectsBoardRows;
            let target = view.controlId ? document.getElementById(view.controlId) : null;
            if (presentationV2 && target?.closest?.('#projects-board-detail') && elements.projectsBoardDetail?.hidden) return;
            if (!target && view.taskId && view.action) target = focusHost?.querySelector(`[data-task-id="${safeCss(view.taskId)}"] ${view.columnKey ? `[data-column-key="${safeCss(view.columnKey)}"] ` : ''}[data-action="${safeCss(view.action)}"]`);
            if (!target && view.taskId && view.selectionControl) {
                target = focusHost?.querySelector(`[data-task-id="${safeCss(view.taskId)}"] [data-action="select-task"]`) || null;
            }
            if (!target && view.taskId && view.fieldKind) {
                const row = focusHost?.querySelector(`[data-task-id="${safeCss(view.taskId)}"]`);
                target = row?.querySelector(`[data-field-kind="${safeCss(view.fieldKind)}"]${view.columnId ? `[data-column-id="${safeCss(view.columnId)}"]` : ''}`) || null;
            }
            if (!target && view.sectionId && view.fieldKind) {
                const row = focusHost?.querySelector(`[data-section-id="${safeCss(view.sectionId)}"]`);
                target = row?.querySelector(`[data-field-kind="${safeCss(view.fieldKind)}"]`) || null;
            }
            if (target) {
                target.focus?.({ preventScroll: true });
                if (view.selectionStart !== null && typeof target.setSelectionRange === 'function') {
                    try { target.setSelectionRange(view.selectionStart, view.selectionEnd ?? view.selectionStart, view.selectionDirection || 'none'); } catch (_) { /* select range is optional */ }
                }
                return;
            }
            if (view.activeId) focusHost?.querySelector(`[data-row-id="${safeCss(view.activeId)}"]`)?.focus?.();
        }

        function invalidateAccess(deniedProjectId, notifyViews = true) {
            if (String(deniedProjectId || '') !== currentProjectId()) return;
            clearQuickCreation();
            closePeoplePicker(); closeStatusPicker(); closeRowEditor(false); renameSession = null;
            remoteObserver?.stop(); draftBases.clear();
            projectEpoch++; refreshSequence++; authorityPending = true;
            stateModel?.switchProject('');
            selection = { projects: selection.projects.filter((entry) => String(entry.id) !== String(deniedProjectId)), selectedProjectId: '', selectedProject: null };
            resetFieldFeedback();
            project = null; membership = null; members = []; sections = []; columns = []; tasks = new Map();
            invalidateHierarchy();
            selectedTaskId = ''; selectedTaskIds = []; focusedRowId = ''; logicalRows = [];
            expanded.clear(); collapsedSections.clear(); loadedBranches.clear(); branchCursors.clear(); branchHasMore.clear(); branchLoadChains.clear();
            drafts.clear(); draftVersions.clear(); settingsDrafts.clear(); pending.clear(); movePending.clear();
            optimisticIdMap.clear(); optimisticSectionIdMap.clear(); recentlyExecutedOperations.clear();
            taskCreateQueue = Promise.resolve(); sectionCreateQueue = Promise.resolve();
            boardRevision.structureRevision = 0; boardRevision.schemaRevision = 0;
            renderedHeaderSignature = ''; renderedSettingsSignature = '';
            clearDragInteraction(); resetSectionForm(); resetColumnForm(); setBusy(false); renderProjectPicker();
            for (const name of ['projectsBoardRows', 'projectsBoardHeader', 'projectsBoardDetailBody', 'projectsBoardDetailTitle', 'projectsBoardCount']) {
                if (elements[name]) { elements[name].innerHTML = ''; elements[name].textContent = ''; }
            }
            for (const name of ['projectsBoardSettingsName', 'projectsBoardSettingsDescription', 'projectsBoardStatusNotStarted', 'projectsBoardStatusInProgress', 'projectsBoardStatusBlocked', 'projectsBoardStatusDone']) {
                if (elements[name]) { elements[name].value = ''; elements[name].disabled = true; }
            }
            if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = true;
            if (presentationV2) clearDetailPresentation();
            else if (elements.projectsBoardDetail) elements.projectsBoardDetail.hidden = true;
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
                projectionTaskIds.clear();
                if (presentationV2) clearDetailPresentation();
                clearQuickCreation();
                closePeoplePicker(); closeStatusPicker(); closeRowEditor(false); renameSession = null;
                remoteObserver?.stop(); draftBases.clear();
                selectedTaskIds = [];
                sharedFilters = {};
                renderedHeaderSignature = '';
                renderedSettingsSignature = '';
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
            if (changed) resetFieldFeedback();
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
                publishContext();
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
            asArray(response?.tasks).forEach((task) => { tasks.set(String(task.id), { ...task }); projectionTaskIds.delete(String(task.id)); });
            if (Array.isArray(response?.sections)) sections = response.sections.slice().sort(rankCompare);
            if (Array.isArray(response?.columns)) columns = response.columns.slice().sort(rankCompare);
            boardRevision.structureRevision = Number(response?.revision?.structureRevision ?? boardRevision.structureRevision);
            boardRevision.schemaRevision = Number(response?.revision?.schemaRevision ?? boardRevision.schemaRevision);
            loadedBranches.add(key);
            branchCursors.set(key, response?.nextCursor || null);
            branchHasMore.set(key, !!response?.nextCursor);
            invalidateHierarchy();
            return response;
        }

        async function loadBranch(parentTaskId = null, { append = false, render = true, fenced = false } = {}) {
            const projectId = currentProjectId();
            if (!projectId || busy) return false;
            if (remoteObserver && !fenced) return remoteObserver.snapshot(projectId, () => loadBranch(parentTaskId, { append, render, fenced: true }));
            const loadSequence = refreshSequence, scope = captureScope();
            const key = parentTaskId || '__root__';
            const cursor = append ? branchCursors.get(key) : null;
            if (append && !cursor) return false;
            try {
                const response = await fetchBranch(projectId, parentTaskId, loadSequence, cursor);
                if (!response || loadSequence !== refreshSequence) return false;
                if (render) renderBoard();
                return true;
            } catch (error) {
                if (loadSequence === refreshSequence && scopeIsCurrent(scope)) {
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
            let hasPartialFailure = false;
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
                if (presentationV2 && (previousRole !== nextMembership.role || (nextProject.lifecycle || 'active') !== 'active')) clearDetailPresentation();
                membership = nextMembership;
                if (previousRole !== nextMembership.role) renderBoard();
                if ((nextProject.lifecycle || 'active') !== 'active') setSelectedTaskIds([]);
                const nextTasks = new Map(), nextLoaded = new Set(), nextCursors = new Map(), nextMore = new Map();
                let nextSections = [], nextColumns = [];
                let nextStructure = Number(nextProject.structureRevision || 0), nextSchema = Number(nextProject.schemaRevision || 0);
                const readBranch = async (parentTaskId = null) => {
                    let cursor = null;
                    let pageCount = 0;
                    do {
                        let response;
                        try {
                            response = await read(queryPath(normalized, parentTaskId, cursor, loadFilters));
                        } catch (pageError) {
                            if (pageCount > 0 && current()) {
                                setStatus(`Some tasks could not be loaded: ${pageError.message || 'connection error'}. Refresh to retry.`, 'warning');
                                const key = parentTaskId || '__root__';
                                nextLoaded.add(key); nextCursors.set(key, cursor); nextMore.set(key, true);
                                hasPartialFailure = true;
                                return true;
                            }
                            throw pageError;
                        }
                        if (!current()) return false;
                        pageCount++;
                        asArray(response?.tasks).forEach(task => nextTasks.set(String(task.id), { ...task }));
                        if (Array.isArray(response?.sections)) nextSections = response.sections.slice().sort(rankCompare);
                        if (Array.isArray(response?.columns)) nextColumns = response.columns.slice().sort(rankCompare);
                        nextStructure = Number(response?.revision?.structureRevision ?? nextStructure);
                        nextSchema = Number(response?.revision?.schemaRevision ?? nextSchema);
                        cursor = response?.nextCursor || null;
                        if (parentTaskId === null && pageCount === 1 && cursor && current()) {
                            project = nextProject;
                            membership = nextMembership;
                            members = asArray(memberResponse?.people);
                            if (preserve) {
                                nextTasks.forEach((t, k) => tasks.set(k, t));
                            } else {
                                tasks = new Map(nextTasks);
                            }
                            sections = nextSections;
                            columns = nextColumns;
                            authorityPending = false;
                            invalidateHierarchy();
                            renderBoard();
                        }
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
                const retainedId = selectedTaskId;
                let retainedTask = null;
                if (preserve && Object.keys(loadFilters).length && retainedId && !nextTasks.has(retainedId) && (nextProject.lifecycle || 'active') === 'active') {
                    try {
                        const result = await apiFetchJson(`/api/projects/${encodeURIComponent(normalized)}/tasks/${encodeURIComponent(retainedId)}`);
                        if (result?.task?.id === retainedId && Number.isSafeInteger(result.task.revision) && (result.task.effectiveLifecycle || result.task.lifecycle || 'active') === 'active') retainedTask = result.task;
                    } catch (error) {
                        if (current() && [401, 403].includes(Number(error.status))) { invalidateAccess(normalized); return false; }
                        if (Number(error.status) !== 404) throw error;
                    }
                    if (!current()) return false;
                }
                publishView = preserve ? snapshotView() : null;
                // An absent task is only known removed when its parent branch was
                // fully reloaded without filters. Unloaded descendants retain intent.
                const previousTasks = tasks;
                const removed = new Set(Object.keys(loadFilters).length || hasPartialFailure ? [] : [...previousTasks]
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
                if (preserve && hasPartialFailure) {
                    const merged = new Map(previousTasks);
                    nextTasks.forEach((t, k) => merged.set(k, t));
                    tasks = merged;
                } else {
                    tasks = nextTasks;
                }
                invalidateHierarchy();
                sections = nextSections; columns = nextColumns;
                projectionTaskIds.clear();
                if (retainedTask && selectedTaskId === retainedId) { tasks.set(retainedId, retainedTask); projectionTaskIds.add(retainedId); }
                loadedBranches = nextLoaded; branchCursors = nextCursors; branchHasMore = nextMore;
                boardRevision.structureRevision = nextStructure; boardRevision.schemaRevision = nextSchema;
                if (!tasks.has(selectedTaskId)) selectedTaskId = '';
                authorityPending = false;
                setSelectedTaskIds(selectedTaskIds);
                authorityRevision += 1;
                if (hasPartialFailure) {
                    successMessage = null;
                } else {
                    successMessage = (project.lifecycle || 'active') === 'active'
                        ? ''
                        : `Project is ${project.lifecycle}. Use project records and recovery to restore it.`;
                }
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
                    if (successMessage !== null && !hasPartialFailure) setStatus(successMessage);
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

        let hierarchyDirty = true;
        let childrenByParent = new Map();
        let rootsByGroupMap = new Map();
        let rowIndexById = new Map();
        let tasksVersion = 0;
        let lastIndexedGroupBy = 'section';

        function invalidateHierarchy() {
            hierarchyDirty = true;
            rowIndexById.clear();
            tasksVersion++;
        }

        function ensureHierarchy() {
            if (!hierarchyDirty && lastIndexedGroupBy === currentGroupBy) return;
            childrenByParent = new Map();
            const activeRoots = [];
            for (const task of tasks.values()) {
                if (projectionTaskIds.has(String(task.id))) continue;
                const lifecycle = task.effectiveLifecycle || task.lifecycle || 'active';
                if (lifecycle !== 'active') continue;
                const parentId = task.parentTaskId ? String(task.parentTaskId) : null;
                if (parentId) {
                    let list = childrenByParent.get(parentId);
                    if (!list) { list = []; childrenByParent.set(parentId, list); }
                    list.push(task);
                } else {
                    activeRoots.push(task);
                }
            }
            for (const list of childrenByParent.values()) {
                list.sort(rankCompare);
            }
            activeRoots.sort(rankCompare);
            childrenByParent.set(null, activeRoots);
            rootsByGroupMap = new Map();
            for (const task of activeRoots) {
                let key;
                if (currentGroupBy === 'section') {
                    key = String(task.effectiveSectionId || task.sectionId || '');
                } else if (currentGroupBy === 'status') {
                    key = String(task.status || 'not_started');
                } else if (currentGroupBy === 'ownerUid') {
                    key = String(task.ownerUid || '__unassigned__');
                } else if (currentGroupBy === 'priority') {
                    key = String(task.values?.priority || task.priority || 'none');
                } else {
                    key = '';
                }
                let list = rootsByGroupMap.get(key);
                if (!list) { list = []; rootsByGroupMap.set(key, list); }
                list.push(task);
            }
            for (const list of rootsByGroupMap.values()) {
                list.sort(rankCompare);
            }
            lastIndexedGroupBy = currentGroupBy;
            hierarchyDirty = false;
        }

        function childrenOf(parentTaskId) {
            ensureHierarchy();
            const parent = parentTaskId ? String(parentTaskId) : null;
            return (childrenByParent.get(parent) || []).map(task => taskFor(task.id) || task);
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
            ensureHierarchy();
            return rootsByGroupMap.get(groupId) || [];
        }

        function rootsForSection(sectionId) {
            if (!presentationV2) return rootsForGroup(sectionId);
            return [...tasks.values()].filter(task => !projectionTaskIds.has(String(task.id)) && !task.parentTaskId && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active' && String(task.effectiveSectionId || task.sectionId) === String(sectionId)).sort(rankCompare);
        }

        function hasPotentialChildren(task) {
            const key = String(task.id);
            if (childrenOf(key).length) return true;
            if (presentationV2 && loadedBranches.has(key) && branchHasMore.get(key) !== true) return false;
            if (Number.isInteger(Number(task.activeChildCount))) return Number(task.activeChildCount) > 0;
            return !loadedBranches.has(key) || branchHasMore.get(key) === true;
        }

        function flattenRows() {
            ensureHierarchy();
            const rows = [];
            const appendTask = (task, depth) => {
                // Hierarchy caches ordering; ordinary edits replace canonical records.
                task = taskFor(task.id) || task;
                rows.push({ kind: 'task', id: `task:${String(task.id)}`, task, depth });
                if (!expanded.has(String(task.id))) return;
                (childrenByParent.get(String(task.id)) || []).forEach((child) => appendTask(child, depth + 1));
            };
            const groups = activeGroups();
            groups.forEach((group) => {
                rows.push({ kind: 'section', id: `section:${group.id}`, section: group, depth: 0 });
                if (!collapsedSections.has(String(group.id))) {
                    const groupRoots = rootsForGroup(group.id);
                    groupRoots.forEach((task) => appendTask(task, 0));
                    if (presentationV2 && currentGroupBy === 'section') rows.push({ kind: 'summary', id: `create:${group.id}`, sectionId: group.id, depth: 0 });
                }
            });
            rowIndexById.clear();
            rows.forEach((row, index) => rowIndexById.set(String(row.id), index));
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
            const selected = multiple ? new Set(Array.isArray(current) ? current : current ? [current] : []) : new Set(current ? [current] : []);
            const options = [`<option value="">${multiple ? 'No additional assignees' : 'Unassigned'}</option>`];
            members.forEach((person) => {
                const uid = String(person.uid || '');
                if (!uid) return;
                options.push(`<option value="${escape(uid)}"${selected.has(uid) ? ' selected' : ''}>${escape(person.displayName || person.email || uid)}</option>`);
            });
            if (presentationV2) selected.forEach(uid => {
                if (uid && !members.some(person => String(person.uid) === String(uid))) options.push(`<option value="${escape(uid)}" selected>${escape(uid)} (unavailable)</option>`);
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
            return asText(person?.displayName || person?.email || (presentationV2 ? `${uid} (unavailable)` : uid));
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
            if (presentationV2 && !columnModel.supported(column.type)) return `<span class="crm-board-unavailable" aria-label="${label}: unavailable column type">${escape(value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : value)} (unavailable)</span>`;
            const unavailable = column.type === 'dropdown' && value && !asArray(column.options).some(option => option.key === value);
            const rollup = column.type === 'number' && task.derived?.columnSums?.[column.id] && task.derived.activeLeafCount > 1 ? task.derived.columnSums[column.id] : null;
            const sumBadge = rollup ? `<span class="crm-board-sum-badge" title="Sum: ${rollup.sum} (Avg: ${rollup.average}, Count: ${rollup.count})">&Sigma; ${rollup.sum}</span>` : '';
            if (!canRenderTaskEditor()) return `${sumBadge}<span class="crm-board-null">${escape(unavailable ? `${value} (unavailable)` : value === null || value === undefined || value === '' ? '—' : (Array.isArray(value) ? value.join(', ') : value))}</span>`;
            if (column.type === 'status') return statusPillMarkup(value, column.statusLabels || {}, disabled, 'value', column.id);
            if (column.type === 'priority') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" data-value="${escape(value || 'none')}" aria-label="${label}"${disabled}>${priorityOptions(value || 'none')}</select>`;
            if (column.type === 'dropdown') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}><option value="">Clear</option>${unavailable ? `<option value="${escape(value)}" selected disabled>${escape(value)} (unavailable)</option>` : ''}${asArray(column.options).map((option) => `<option value="${escape(option.key)}"${value === option.key ? ' selected' : ''}>${escape(option.label || option.key)}</option>`).join('')}</select>`;
            if (presentationV2 && column.type === 'people') return `<button type="button" class="crm-people-trigger" data-action="pick-people" data-people-kind="value" aria-label="${label}: ${escape((Array.isArray(value) ? value : value ? [value] : []).map(memberName).join(', ') || 'Add people')}"${disabled}>${escape((Array.isArray(value) ? value : value ? [value] : []).map(memberName).join(', ') || 'Add people')}</button><select multiple class="crm-board-field crm-board-people-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}>${memberOptions(value, true)}</select>`;
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
            const depthChip = !presentationV2 && depth > 0 ? `<span class="crm-board-depth-chip" title="Subtask Level ${depth}">L${depth}</span>` : '';
            const status = drafts.get(draftKeyFor(task.id, 'status')) ?? task.status ?? 'not_started';
            const hasKids = hasPotentialChildren(task);
            const isExp = expanded.has(String(task.id));
            const expander = hasKids
                ? `<button type="button" class="crm-board-expander" data-action="toggle-task" aria-label="${isExp ? 'Collapse' : 'Expand'} ${escape(title)}" aria-expanded="${isExp ? 'true' : 'false'}">${isExp ? '▾' : '▸'}</button>`
                : presentationV2 ? '<span class="crm-board-leaf-space" aria-hidden="true"></span>' : `<button type="button" class="crm-board-expander is-leaf" data-action="add-subtask" aria-label="Add subtask to ${escape(title)}" title="Add subtask (Ctrl+N)">▸</button>`;
            const selectionInput = `<input type="checkbox" data-action="select-task" aria-label="Select ${escape(title)}"${selectedTaskIds.includes(String(task.id)) ? ' checked' : ''}>`;
            const selectionCheckbox = selectableTask(task) ? (presentationV2 ? `<label class="crm-board-selection-hit">${selectionInput}</label>` : selectionInput) : '';
            const inputState = (authorityPending || busy) && canRenderTaskEditor() ? ' readonly' : disabled;
            const titleCell = presentationV2 && renameSession?.taskId !== String(task.id)
                ? `<button type="button" class="crm-board-title-button" data-action="open-detail" aria-label="Open task: ${escape(title)}">${escape(title)}</button>`
                : canRenderTaskEditor()
                ? `<input class="crm-board-title-input crm-board-field" data-field-kind="title" type="text" value="${escape(title)}" aria-label="Task title"${inputState}>${presentationV2 ? `<button type="button" data-action="save-rename" aria-label="Save task name"${disabled}>✓</button><button type="button" data-action="cancel-rename" aria-label="Cancel rename">×</button>` : ''}`
                : `<span class="crm-board-title-text">${escape(title)}</span>`;
            const dState = presentationV2 ? 'none' : dueState(task);
            const relDue = relativeDue(dueDate);
            const dueBadge = relDue && dState !== 'none' && dState !== 'normal' ? `<span class="crm-board-due-badge crm-board-due-${dState}">${escape(relDue)}</span>` : '';
            const workingDays = presentationV2 ? null : computeWorkingDays(startDate, dueDate);
            // Two date inputs plus two badges do not fit a 238px cell. The due state is
            // the actionable signal, so duration yields to it and stays available as a title.
            const durationBadge = workingDays !== null && !dueBadge ? `<span class="crm-board-duration-badge" title="${workingDays} working days">${workingDays}d</span>` : '';
            const optClass = task.isOptimistic ? ' is-optimistic' : '';
            return `<div class="crm-projects-board-row${selected ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}${optClass}" role="row" tabindex="0"${canWrite() ? ' aria-keyshortcuts="Alt+ArrowRight Alt+ArrowLeft" aria-description="Alt+Right indents; Alt+Left outdents. Tab navigates controls."' : ''} draggable="${canWrite() && !busy && !movePending.has(pendingKey(task.id)) && (!presentationV2 || currentGroupBy === 'section' && !sharedFilters.sort) ? 'true' : 'false'}" data-row-kind="task" data-row-id="${escape(row.id)}" data-task-id="${escape(task.id)}" data-depth="${presentationV2 ? Math.max(0, Number(row.depth) || 0) : depth}" aria-selected="${selected ? 'true' : 'false'}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px;--crm-project-group-color:${taskGroupColor(task)}">
              <div class="crm-projects-board-cell crm-projects-board-task-title" role="cell" data-column-key="taskTitle" style="padding-left:${10 + indent}px">${treeElbow}${depthChip}${task.contextOnly ? '<span class="crm-projects-context">Context</span>' : ''}${selectionCheckbox}${expander}<button type="button" class="crm-board-drag-handle" data-action="drag-handle" aria-label="Move ${escape(title)}">⠿</button>${presentationV2 ? '' : derivedRing(task)}${titleCell}<button type="button" class="crm-board-add-subtask" data-action="add-subtask" title="Add subtask (Ctrl+N)" aria-label="Add subtask to ${escape(title)}"${disabled}>+</button>${presentationV2 ? `<button type="button" class="crm-board-task-menu" data-action="task-menu" aria-label="More actions for ${escape(title)}" aria-haspopup="dialog"${disabled}>⋯</button>${branchLoading.has(String(task.id)) ? '<span class="crm-branch-status" role="status">Loading subtasks…</span>' : isExp && branchHasMore.get(String(task.id)) ? '<button type="button" data-action="load-subtasks">Load more subtasks</button>' : ''}` : `<button type="button" class="crm-board-detail-button" data-action="open-detail" aria-label="Open details and discussion for ${escape(title)}">&#8599;</button>`}</div>
              <div class="crm-projects-board-cell crm-board-status-cell" role="cell" data-column-key="status" data-status="${escape(status)}">${statusBatteryBar(task)}${statusPillMarkup(status, project?.statusLabels || {}, disabled, 'status')}</div>
              <div class="crm-projects-board-cell crm-board-owner-cell" role="cell" data-column-key="ownerUid"><button type="button" class="crm-people-trigger" data-action="pick-people" data-people-kind="ownerUid" aria-haspopup="listbox" aria-label="Change accountable owner for ${escape(title)}${presentationV2 ? `: ${escape(memberName(ownerUid) || 'Unassigned')}` : ''}"${disabled}><span class="crm-board-owner-avatar" aria-hidden="true">${escape(ownerInitials(ownerUid))}</span><span class="crm-people-trigger-name">${escape(memberName(ownerUid) || (presentationV2 ? 'Unassigned' : 'Assign'))}</span></button><select class="crm-board-field" data-field-kind="ownerUid" aria-label="Accountable owner"${disabled}>${memberOptions(ownerUid)}</select></div>
              <div class="crm-projects-board-cell crm-board-assignees-cell" role="cell" data-column-key="assigneeUids"><button type="button" class="crm-people-trigger is-stack" data-action="pick-people" data-people-kind="assigneeUids" aria-haspopup="listbox" aria-label="${presentationV2 ? `Collaborators for ${escape(title)}: ${escape(asArray(assignees).map(memberName).join(', ') || 'Add collaborators')}` : `Change assignees for ${escape(title)}`}"${disabled}>${peopleStack(assignees) || `<span class="crm-people-trigger-name">${presentationV2 ? 'Add collaborators' : 'Assign'}</span>`}</button><select multiple class="crm-board-field crm-board-people-field" data-field-kind="assigneeUids" aria-label="Additional assignees"${disabled}>${memberOptions(assignees, true)}</select></div>
              <div class="crm-projects-board-cell crm-board-date-cell" role="cell" data-column-key="dates" data-due-state="${dState}">${presentationV2 ? `<button type="button" class="crm-board-date-trigger" data-action="edit-dates" aria-haspopup="dialog" aria-label="Edit dates for ${escape(title)}"${disabled}>${escape(startDate || 'No start')} → ${escape(dueDate || 'No due')}</button><span class="crm-working-days">Working days not confirmed</span>` : `${dueBadge}${durationBadge}${dateControl('startDate', startDate, disabled)}${dateControl('dueDate', dueDate, disabled)}`}</div>
              ${columns.map((column) => `<div class="crm-projects-board-cell" role="cell" data-column-key="custom:${escape(column.id)}" data-column-id="${escape(column.id)}">${customCell(task, column)}</div>`).join('')}
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
            if (presentationV2) return `<div class="crm-projects-board-row crm-quick-footer" role="row" data-row-kind="summary" data-row-id="${escape(row.id)}" data-section-id="${escape(row.sectionId)}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px">${visibleColumns.map(column => `<div class="crm-projects-board-cell" role="cell" data-column-key="${escape(column.key)}">${column.key === 'taskTitle' ? `<button type="button" data-action="quick-task"${canWrite() && !busy ? '' : ' disabled'}>Add a task…</button>` : ''}</div>`).join('')}</div>`;

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
              <div class="crm-projects-board-cell crm-board-summary-title" role="cell" data-column-key="taskTitle"><span class="crm-board-summary-tag">SUMMARY</span> <span class="crm-muted">${totalCount} task${totalCount === 1 ? '' : 's'}</span></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell" data-column-key="status"><span class="crm-board-summary-stat">${doneCount}/${totalCount} done (${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%)</span></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell" data-column-key="ownerUid"><span class="crm-board-summary-stat">${owners.size} owner${owners.size === 1 ? '' : 's'}</span></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell" data-column-key="assigneeUids"></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell" data-column-key="dates"></div>
              ${columns.map((col) => `<div class="crm-projects-board-cell crm-board-summary-cell" role="cell" data-column-key="custom:${escape(col.id)}" data-column-id="${escape(col.id)}">${numericSums[col.id] !== undefined ? `<span class="crm-board-sum-badge">&Sigma; ${numericSums[col.id]}</span>` : ''}</div>`).join('')}
            </div>`;
        }

        let renderedHeaderSignature = '';
        function renderHeader() {
            if (!elements.projectsBoardHeader) return;
            const schema = canSchema();
            if (presentationV2 && tableLayout) {
                visibleColumns = tableLayout.resolve(columns, currentProjectId());
                const layout = columnModel.geometry(visibleColumns);
                elements.projectsBoardTable.style.setProperty('--crm-project-grid-template', layout.template);
                elements.projectsBoardTable.style.minWidth = `${layout.minimumWidth}px`;
                elements.projectsBoardTable.setAttribute('aria-colcount', String(visibleColumns.length));
                elements.projectsBoardHeader.setAttribute('aria-rowindex', '1');
                const signature = JSON.stringify([currentProjectId(), schema, busy, visibleColumns.map(c => [c.key,c.label,c.readonly])]);
                if (signature !== renderedHeaderSignature) {
                    renderedHeaderSignature = signature;
                    elements.projectsBoardHeader.innerHTML = visibleColumns.map((c, i) => `<div role="columnheader" data-column-key="${escape(c.key)}" aria-colindex="${i + 1}"${c.source ? ` data-column-id="${escape(c.source.id)}"${schema && !busy ? ' draggable="true"' : ''}` : ''}><span class="crm-projects-board-column-label" title="${escape(c.label)}">${escape(c.label)}</span>${c.source && schema ? `<button type="button" data-action="edit-column" data-column-id="${escape(c.source.id)}" aria-label="Edit column ${escape(c.label)}"${busy ? ' disabled' : ''}>Edit column</button>` : ''}<span role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize ${escape(c.label)}" aria-valuemin="${c.min}" aria-valuemax="${c.max}" data-column-resize="${escape(c.key)}"></span></div>`).join('');
                }
                elements.projectsBoardHeader.querySelectorAll('[data-column-resize]').forEach(handle => { const c = visibleColumns.find(c => c.key === handle.dataset.columnResize); handle.setAttribute('aria-valuenow', String(c.width)); handle.setAttribute('aria-valuetext', `${c.width} pixels`); });
                return;
            }
            const sig = `${currentProjectId()}:${schema}:${busy}:${columns.map((c) => `${c.id}:${c.label || c.id}`).join('|')}`;
            if (renderedHeaderSignature === sig && elements.projectsBoardHeader.innerHTML !== '') return;
            renderedHeaderSignature = sig;
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
            elements.projectsBoardHeader.innerHTML = base.concat(columns.map((column) => column.label || column.id)).map((label, index) => `<div role="columnheader"${index >= 5 && schema ? ' class="crm-projects-board-column-editable"' : ''}${index >= 5 && schema && !busy ? ` draggable="true" data-column-id="${escape(columns[index - 5].id)}"` : ''}><span class="crm-projects-board-column-label" title="${escape(label)}">${escape(label)}</span>${index >= 5 && schema ? `<button type="button" data-action="edit-column" data-column-id="${escape(columns[index - 5].id)}" aria-label="Edit column ${escape(label)}"${busy ? ' disabled' : ''}>Edit column</button>` : ''}</div>`).join('');
        }

        function rowMarkup(row) {
            if (row.kind === 'section') return sectionRowMarkup(row);
            if (row.kind === 'summary') return sectionSummaryRowMarkup(row);
            return taskRowMarkup(row);
        }

        function createRowNode(row) {
            const template = document.createElement('template');
            template.innerHTML = rowMarkup(row).trim();
            const node = template.content.firstElementChild;
            if (presentationV2 && node) {
                node.querySelectorAll('.crm-board-field[data-column-id]').forEach(control => { control.dataset.columnType = columns.find(c => String(c.id) === control.dataset.columnId)?.type || ''; });
                node.setAttribute('aria-rowindex', String(row.index + 2));
                if (row.kind !== 'section') {
                    const cells = new Map(Array.from(node.children).map(cell => [cell.dataset.columnKey, cell]));
                    const rowColumns = mobileList && row.kind === 'task' ? [...['taskTitle', 'ownerUid', 'status'].map(key => ({ key })), ...visibleColumns.filter(c => !['taskTitle', 'ownerUid', 'status'].includes(c.key))] : visibleColumns;
                    node.replaceChildren(...rowColumns.map((c, index) => { const cell = cells.get(c.key); cell.setAttribute('aria-colindex', String(index + 1)); return cell; }));
                } else {
                    if (node.children[1]) { node.firstElementChild.append(...node.children[1].childNodes); node.children[1].remove(); }
                    node.firstElementChild.setAttribute('aria-colspan', String(visibleColumns.length));
                }
            }
            return node;
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
                && (currentControl.dataset.columnId || '') === (freshControl.dataset.columnId || '')
                && (!presentationV2 || currentControl.dataset.columnType === freshControl.dataset.columnType);
            if (compatible && currentControl.tagName === 'INPUT') currentControl.readOnly = freshControl.readOnly;
            return compatible;
        }

        function syncRowMetadata(node, fresh) {
            const transientClasses = ['is-drop-target', 'is-drop-parent', 'is-dragging']
                .filter((className) => node.classList.contains(className));
            node.className = fresh.className;
            transientClasses.forEach((className) => node.classList.add(className));
            ['role', 'tabindex', 'draggable', 'aria-selected', 'aria-rowindex', 'data-row-kind', 'data-row-id', 'data-task-id', 'data-section-id'].forEach((attribute) => {
                if (fresh.hasAttribute(attribute)) node.setAttribute(attribute, fresh.getAttribute(attribute));
                else node.removeAttribute(attribute);
            });
        }

        function syncSelectionCheckbox(node, fresh) {
            const current = node.querySelector('[data-action="select-task"]');
            const next = fresh.querySelector('[data-action="select-task"]');
            if (current && !next) (current.closest('.crm-board-selection-hit') || current).remove();
            else if (!current && next) node.querySelector('.crm-projects-board-task-title')?.prepend((next.closest('.crm-board-selection-hit') || next).cloneNode(true));
            else if (current && next) { current.checked = next.checked; current.setAttribute('aria-label', next.getAttribute('aria-label')); }
        }
        function syncFocusedSelectionCell(cell, freshCell, checkbox, action = 'select-task') {
            const nextCheckbox = freshCell?.querySelector(`[data-action="${action}"]`);
            if (!cell || !nextCheckbox || !cell.contains(checkbox)) return false;
            const retained = checkbox.closest('.crm-board-selection-hit') || checkbox;
            const replacement = nextCheckbox.closest('.crm-board-selection-hit') || nextCheckbox;
            // Keep the focused action attached. Refresh its surroundings so
            // current permissions and remote titles never retain stale editors.
            for (const child of Array.from(cell.childNodes)) if (child !== retained) child.remove();
            for (const attribute of Array.from(cell.attributes)) if (!freshCell.hasAttribute(attribute.name)) cell.removeAttribute(attribute.name);
            for (const attribute of Array.from(freshCell.attributes)) cell.setAttribute(attribute.name, attribute.value);
            let beforeCheckbox = true;
            for (const child of Array.from(freshCell.childNodes)) {
                if (child === replacement) { beforeCheckbox = false; continue; }
                if (beforeCheckbox) cell.insertBefore(child, retained);
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
            for (const selector of (presentationV2 ? [] : ['.crm-board-status-cell', '[data-field-kind="status"]', '.crm-board-status-pill'])) {
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
            if (avatar && !presentationV2) avatar.textContent = fresh.querySelector('.crm-board-owner-avatar')?.textContent || '—';
            syncSelectionCheckbox(node, fresh);
            if (interactionPinned && !presentationV2 && activeElement?.dataset?.action !== 'select-task') {
                syncPinnedExpander(node, fresh);
                return;
            }
            const focusedCell = (activeElement?.classList?.contains('crm-board-field') || ['select-task', 'toggle-section', 'open-detail', 'pick-status', 'pick-people'].includes(activeElement?.dataset?.action))
                ? activeElement.closest?.('[data-column-key], [role="cell"]')
                : null;
            const cells = Array.from(node.children);
            const freshCells = Array.from(fresh.children || []);
            const keyed = presentationV2 && row.kind !== 'section';
            const cellsByKey = new Map(cells.map(cell => [cell.dataset?.columnKey, cell]));
            const cellCount = Math.max(cells.length, freshCells.length);
            for (let index = 0; index < cellCount; index += 1) {
                const freshCell = freshCells[index];
                const cell = keyed ? cellsByKey.get(freshCell?.dataset?.columnKey) : cells[index];
                if (keyed && cell && freshCell) cell.setAttribute('aria-colindex', freshCell.getAttribute('aria-colindex'));
                if (keyed && interactionPinned && cell && freshCell) continue;
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
                            if (presentationV2) activeElement.innerHTML = next.innerHTML;
                            else activeElement.textContent = next.textContent;
                        }
                        if (presentationV2) activeElement.disabled = next.disabled;
                        if (syncFocusedSelectionCell(cell, freshCell, activeElement, action)) continue;
                    }
                }
                if (cell && cell === focusedCell && activeElement?.dataset?.action === 'select-task' && syncFocusedSelectionCell(cell, freshCell, activeElement)) continue;
                if (cell && cell === focusedCell && canPreserveFocusedEditor(cell, freshCell, activeElement)) continue;
                if (cell && freshCell) cell.replaceWith(freshCell);
                else if (freshCell) node.appendChild(freshCell);
                else if (cell) cell.remove();
            }
            if (keyed) {
                const keys = new Set(freshCells.map(cell => cell.dataset.columnKey));
                Array.from(node.children).forEach(cell => { if (!keys.has(cell.dataset.columnKey)) cell.remove(); });
                const ordered = new Map(Array.from(node.children).map(cell => [cell.dataset.columnKey, cell]));
                freshCells.forEach((cell, index) => { const target = ordered.get(cell.dataset.columnKey); if (node.children[index] !== target) node.insertBefore(target, node.children[index] || null); });
                if (focusedCell && node.contains(activeElement) && document.activeElement !== activeElement && !elements.projectsBoardTableWrap?.hidden) activeElement.focus({ preventScroll: true });
            }
            syncFocusedControl(node, row);
        }

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('pointerdown', (event) => {
                if (presentationV2 && rowEditor && !rowEditor.node.contains(event.target) && !rowEditor.trigger?.contains(event.target) && !event.target.closest?.('.crm-datepick')) closeRowEditor(false);
                if (peoplePopover && !peoplePopover.contains(event.target) && !event.target.closest?.('[data-action="pick-people"]')) {
                    closePeoplePicker();
                }
                if (statusPopover && !statusPopover.contains(event.target) && !event.target.closest?.('[data-action="pick-status"]')) {
                    closeStatusPicker();
                }
            }, true);
        }

        let renderedRowHeight = ROW_HEIGHT, renderedProject = '';
        function renderVirtualRows({ viewportOnly = false, focusRowId = '' } = {}) {
            if (!elements.projectsBoardRows || !elements.projectsBoardScroll) return;
            // Scroll only changes which current rows are mounted. Data, schema,
            // permissions and selection always use the default full render.
            if (!viewportOnly) {
                const oldPosition = (elements.projectsBoardScroll.scrollTop || 0) / renderedRowHeight;
                const anchor = presentationV2 && !mobileList && renderedProject === currentProjectId() ? logicalRows[Math.floor(oldPosition)]?.id : null;
                logicalRows = flattenRows().map((row, index) => ({ ...row, index }));
                if (mobileProject !== currentProjectId()) { mobileProject = currentProjectId(); mobileLimit = 50; }
                const totalHeight = logicalRows.length * ROW_HEIGHT;
                elements.projectsBoardRows.style.height = `${Math.max(totalHeight, ROW_HEIGHT)}px`;
                if (anchor) { const index = logicalRows.findIndex(row => row.id === anchor); if (index >= 0) elements.projectsBoardScroll.scrollTop = (index + oldPosition % 1) * ROW_HEIGHT; }
                renderedRowHeight = ROW_HEIGHT; renderedProject = currentProjectId();
                elements.projectsBoardTable?.setAttribute('aria-rowcount', String(logicalRows.length + (presentationV2 ? 1 : 0)));
            }
            reconcileRowEditors();
            if (mobileList) {
                const activeId = document.activeElement?.closest('[data-row-id]')?.dataset.rowId;
                for (const id of [focusRowId || activeId || focusedRowId]) {
                    const index = logicalRows.findIndex(row => row.id === id);
                    if (index >= mobileLimit || index >= 0 && index < mobileLimit - MOBILE_WINDOW) mobileLimit = Math.ceil((index + 1) / 50) * 50;
                }
            }
            const scrollTop = elements.projectsBoardScroll.scrollTop || 0;
            const viewport = Math.max(ROW_HEIGHT, (elements.projectsBoardScroll.clientHeight || 420) - (presentationV2 ? elements.projectsBoardHeader?.offsetHeight || 0 : 0));
            const { first, last } = mobileList ? { first: Math.max(0, mobileLimit - MOBILE_WINDOW), last: Math.min(mobileLimit, logicalRows.length) } : presentationV2 ? columnModel.windowRange(logicalRows.length, ROW_HEIGHT, scrollTop, viewport, 0, OVERSCAN) : {
                first: Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN),
                last: Math.min(logicalRows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
            };
            const visibleRows = logicalRows.slice(first, last);
            const activeElement = currentSuspendedTableEdit()?.active || document.activeElement;
            const activeRow = activeElement?.closest?.('[data-row-id]');
            const activeRowId = activeRow?.dataset?.rowId || '';
            const sourceRowId = dragSourceRowId();
            const pickerRowId = presentationV2 ? (rowEditor?.taskId || statusContext?.taskId || peopleContext?.taskId) : null;
            const pinnedIds = new Set([activeRowId, sourceRowId, dragHoverTargetRowId, focusRowId, presentationV2 ? focusedRowId : '', pickerRowId ? `task:${pickerRowId}` : ''].filter(Boolean));
            const pinnedRows = [];
            pinnedIds.forEach((id) => {
                const idx = typeof rowIndexById !== 'undefined'
                    ? rowIndexById.get(String(id))
                    : logicalRows.findIndex((row) => String(row.id) === String(id));
                if (idx !== undefined && idx !== -1 && (idx < first || idx >= last)) {
                    pinnedRows.push(logicalRows[idx]);
                }
            });
            const desiredRows = visibleRows.concat(pinnedRows);
            if (presentationV2) desiredRows.sort((a, b) => a.index - b.index);
            if (!desiredRows.length) {
                elements.projectsBoardRows.innerHTML = '<div class="crm-projects-board-loading">No tasks yet. Add a task to begin.</div>';
                syncListSemantics();
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
                    existing.set(String(row.id), node);
                } else if (!viewportOnly) {
                    const interactionPinned = String(row.id) === sourceRowId || String(row.id) === dragHoverTargetRowId || (presentationV2 && String(row.task?.id) === String(pickerRowId));
                    updateExistingRow(node, row, activeElement, interactionPinned);
                    if (!presentationV2) {
                        const expected = elements.projectsBoardRows.children[desiredRows.indexOf(row)];
                        if (expected !== node) elements.projectsBoardRows.insertBefore(node, expected || null);
                    }
                }
                if (!node.dataset.crmFocusBound) {
                    node.dataset.crmFocusBound = 'true';
                    node.addEventListener('focusin', () => { focusedRowId = node.dataset.rowId || ''; rowNavigationStops(); });
                }
            });
            if (presentationV2) {
                const container = elements.projectsBoardRows;
                // Keep the drag source (or focused row) attached even on engines
                // without state-preserving moves. Reconcile its siblings around it.
                const stationary = existing.get(sourceRowId) || activeRow;
                const start = activeElement?.selectionStart, end = activeElement?.selectionEnd;
                const direction = activeElement?.selectionDirection;
                let before = null;
                for (let index = desiredRows.length - 1; index >= 0; index -= 1) {
                    const node = existing.get(String(desiredRows[index].id));
                    if (!node) continue;
                    if (node !== stationary && node.nextElementSibling !== before) {
                        if (typeof container.moveBefore === 'function') container.moveBefore(node, before);
                        else container.insertBefore(node, before);
                    }
                    before = node;
                }
                // Legacy DOM moves can blur a separate focused row during a drag.
                // Restore only that same retained control, without moving the viewport.
                if (activeRow && container.contains(activeElement) && document.activeElement !== activeElement && !elements.projectsBoardTableWrap?.hidden) {
                    activeElement.focus({ preventScroll: true });
                    if (typeof start === 'number') activeElement.setSelectionRange(start, end, direction);
                }
            }
            if (presentationV2) { syncListSemantics(); elements.projectsBoardRows.querySelectorAll('[data-task-id]').forEach(row => paintFieldFeedback(row.dataset.taskId, row)); }
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

        function renderDetail(request = {}) {
            const detail = elements.projectsBoardDetail;
            if (!detailSurface && globalScope.CrmProjectsDetailSurfaceV2?.hasOwner(detail)) return;
            // Keyboard/pointer moves select a row without requesting a modal.
            // Only explicit open actions establish an intent, scoped to the
            // current project/actor so delayed renders cannot reopen old details.
            if (request.open) detailOpenIntent = { taskId: String(selectedTaskId), scope: captureScope() };
            const task = detailOpenIntent && scopeIsCurrent(detailOpenIntent.scope)
                && detailOpenIntent.taskId === String(selectedTaskId) ? taskFor(selectedTaskId) : null;
            if (!task) detailOpenIntent = null;
            if (presentationV2 && detailSurface) {
                if (!task || String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid || (project?.lifecycle || 'active') !== 'active') { clearDetailPresentation(!!lastDetailTaskId); return; }
                const changed = String(task.id) !== String(lastDetailTaskId);
                if (changed) { detailGeneration++; clearRemoteConflictReview(); globalScope.CrmProjectsDiscussion?.setSelection(null); }
                lastDetailTaskId = String(task.id);
                if (elements.projectsBoardDetailTitle) elements.projectsBoardDetailTitle.textContent = asText(task.title, 'Task details');
                renderOverview(task);
                const discussionContext = { projectId: currentProjectId(), taskId: task.id, taskRevision: Number(task.revision || 0), role: role(), lifecycle: task.effectiveLifecycle || task.lifecycle || 'active' };
                const nextDiscussionKey = JSON.stringify(discussionContext);
                if (changed || detailDiscussionKey !== nextDiscussionKey) {
                    detailDiscussionKey = nextDiscussionKey;
                    deps.onTaskSelection?.(task);
                    globalScope.CrmProjectsDiscussion?.setSelection({ ...discussionContext, deferLoad: changed || detailSurface.activeTab() !== 'updates' });
                }
                detailSurface.sync(task, request);
                mountRemoteConflictReview();
                return;
            }
            if (task && String(task.id) !== String(lastDetailTaskId)) {
                lastDetailTaskId = String(task.id);
                activateDetailTab(presentationV2 ? 'details' : 'updates');
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
            if (presentationV2 && canWrite() && elements.projectsBoardDetailBody) {
                const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Add subtask';
                add.addEventListener('click', () => { openQuickComposer(task.id); }); elements.projectsBoardDetailBody.append(add);
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

        let renderedSettingsSignature = '';
        function renderSettings() {
            const owner = canSchema();
            const nameKey = scopedKey(currentProjectId(), 'settings:name');
            const descriptionKey = scopedKey(currentProjectId(), 'settings:description');
            const nameDraft = settingsDrafts.get(nameKey) || '';
            const descDraft = settingsDrafts.get(descriptionKey) || '';
            const statusDraftsStr = ['not_started', 'in_progress', 'blocked', 'done'].map((k) => settingsDrafts.get(scopedKey(currentProjectId(), `settings:status:${k}`)) || '').join('|');
            const sig = `${currentProjectId()}:${owner}:${busy}:${project?.name || project?.title || ''}:${project?.description || ''}:${JSON.stringify(project?.statusLabels || {})}:${nameDraft}:${descDraft}:${statusDraftsStr}`;
            if (renderedSettingsSignature === sig) return;
            renderedSettingsSignature = sig;
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

        function renderBoard({ focusRowId = '', projectionChanged = false } = {}) {
            mountRemoteConflictReview();
            publishContext({ projectionChanged });
            if (!hasProject()) return;
            globalScope.CrmProjectsRecovery?.setSelection({ projectId: currentProjectId(), role: role(), lifecycle: project?.lifecycle || 'active' });
            if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = (project?.lifecycle || 'active') !== 'active';
            if ((project?.lifecycle || 'active') !== 'active') { if (presentationV2) clearDetailPresentation(); globalScope.CrmProjectsDiscussion?.setSelection(null); return; }
            if (elements.projectsBoardEmpty) elements.projectsBoardEmpty.hidden = true;
            renderHeader();
            renderVirtualRows({ focusRowId });
            renderDetail();
            renderSettings();
            syncSectionForm();
            if (presentationV2 && elements.projectsBoardAddSection && elements.projectsBoardTableWrap) elements.projectsBoardTableWrap.after(elements.projectsBoardAddSection);
            renderBatchDock();
            if (quickComposer && !canWrite()) { quickComposer.node.remove(); quickComposer = null; composerDrafts.clear(); }
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
                    if (options.scope && (!scopeIsCurrent(options.scope) || !canWrite() || options.schema && !canSchema())) throw Object.assign(new Error('Project or permission changed before dispatch.'), { status: 403 });
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

        function validateRowValue(taskId, kind, value, control) {
            if (!canWrite() || busy || !taskFor(taskId) || control.disabled || control.readOnly) throw new Error('Editing is unavailable. Refresh project access.');
            if (kind === 'title') {
                if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Enter a task title (up to 200 characters).');
            } else if (kind === 'status' && !STATUS_KEYS.includes(value)) throw new Error('Choose a supported status.');
            else if (kind === 'dates') {
                const range = dateRange(value);
                if (range.startDate && range.dueDate && (!control.schedulePreview?.token || !control.schedulePreview.canApply)) throw new Error('Preview the date range before applying it.');
            } else if (['startDate', 'dueDate'].includes(kind)) {
                dateRange({ startDate: kind === 'startDate' ? value : effectiveField(taskId, 'startDate'), dueDate: kind === 'dueDate' ? value : effectiveField(taskId, 'dueDate') });
            } else if (kind === 'ownerUid' || kind === 'assigneeUids') {
                const selected = kind === 'ownerUid' ? value ? [value] : [] : asArray(value);
                const previous = kind === 'ownerUid' ? [taskFor(taskId).ownerUid] : asArray(taskFor(taskId).assigneeUids);
                if (selected.some(uid => !members.some(person => person.uid === uid) && !previous.includes(uid))) throw new Error('This person is unavailable.');
                if (kind === 'assigneeUids' && selected.includes(effectiveField(taskId, 'ownerUid'))) throw new Error('The owner cannot also be a collaborator.');
            } else if (kind === 'value') {
                const column = columns.find(item => String(item.id) === String(control.dataset?.columnId));
                if (!column || !columnModel.supported(column.type) || column.lifecycle === 'archived') throw new Error('This column is unavailable for editing.');
                if (control.dataset?.columnType && control.dataset.columnType !== column.type) throw new Error('Column type changed. Review the value before editing again.');
                if (value == null || value === '') return null;
                if (column.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Enter a finite number.');
                if (column.type === 'date') dateOnly(value);
                if (column.type === 'text' && (typeof value !== 'string' || value.length > 5000)) throw new Error('Enter text up to 5000 characters.');
                if (column.type === 'priority' && !PRIORITY_KEYS.includes(value)) throw new Error('Choose a supported priority.');
                if (column.type === 'status' && !STATUS_KEYS.includes(value)) throw new Error('Choose a supported status.');
                if (column.type === 'dropdown' && !asArray(column.options).some(option => option.key === value)) throw new Error('This option is unavailable. Choose an available option or clear it.');
                if (column.type === 'people' && !Array.isArray(value)) throw new Error('Choose people from the member list.');
            }
            return value;
        }

        function focusRowControl(taskId, selector = '.crm-board-title-button') {
            const detailRow = elements.projectsBoardDetail?.open && elements.projectsBoardDetailBody?.querySelector(`[data-task-id="${cssEscape(taskId)}"]`);
            const row = detailRow || elements.projectsBoardRows?.querySelector(`[data-task-id="${cssEscape(taskId)}"]`);
            (row?.querySelector(selector) || row)?.focus({ preventScroll: true });
        }
        function closeRowEditor(restore = true) {
            if (!rowEditor) return;
            const old = rowEditor; rowEditor = null; globalScope.CrmProjectsDatePicker?.close(); old.node.remove();
            if (restore && scopeIsCurrent(old.scope)) { renderVirtualRows(); focusRowControl(old.taskId, old.returnSelector); }
        }
        function reconcileRowEditors() {
            if (!presentationV2) return;
            if (!canWrite() || busy) { closePeoplePicker(); closeStatusPicker(); closeRowEditor(false); }
            if (rowEditor && (!scopeIsCurrent(rowEditor.scope) || !taskFor(rowEditor.taskId))) closeRowEditor(false);
            if (rowEditor?.columnId && columns.find(c => c.id === rowEditor.columnId)?.type !== rowEditor.columnType) closeRowEditor(false);
            for (const context of [statusContext, peopleContext]) {
                if (!context) continue;
                const column = context.columnId && columns.find(c => String(c.id) === String(context.columnId));
                if (!scopeIsCurrent(context.scope) || !taskFor(context.taskId) || (context.columnId && (!column || column.type !== context.columnType))) {
                    closePeoplePicker(); closeStatusPicker(); break;
                }
            }
            if (renameSession && (!scopeIsCurrent(renameSession.scope) || !canRenderTaskEditor() || !taskFor(renameSession.taskId))) renameSession = null;
        }
        function followRowPicker(node, context) {
            if (!node || !context?.trigger?.isConnected) return false;
            const box = context.trigger.getBoundingClientRect(), viewport = elements.projectsBoardScroll.getBoundingClientRect();
            // Hidden tabs and native viewport transitions can briefly measure zero.
            if (!box.width || !viewport.width) return true;
            if (!context.trigger.closest('dialog[open]') && (box.bottom < viewport.top || box.top > viewport.bottom)) return false;
            const panel = document.querySelector('[data-panel="projects"]');
            const scale = parseFloat(globalScope.getComputedStyle?.(panel || document.body).zoom) || 1;
            const width = node.getBoundingClientRect().width || 280, height = node.getBoundingClientRect().height || 260;
            node.style.left = `${Math.max(8, Math.min(box.left, (globalScope.innerWidth || 1024) - width - 8)) / scale}px`;
            node.style.top = `${Math.max(8, Math.min(box.bottom + 4, (globalScope.innerHeight || 768) - height - 8)) / scale}px`;
            return true;
        }
        function openRowEditor(taskId, kind, trigger, markup) {
            closePeoplePicker(); closeRowEditor(false);
            if (!presentationV2 || !canWrite() || busy || !taskFor(taskId)) return null;
            const node = document.createElement('div'); node.className = 'crm-row-editor'; node.dataset.rowEditor = kind;
            node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', `${kind === 'menu' ? 'Task actions' : kind === 'dates' ? 'Edit dates' : 'Move task'}: ${taskFor(taskId).title}`);
            node.innerHTML = markup + '<button type="button" data-close-editor>Close</button>';
            (trigger?.closest('dialog[open]') || document.querySelector('[data-panel="projects"]') || document.body).appendChild(node);
            const box = trigger.getBoundingClientRect();
            node.style.left = `${Math.max(8, Math.min(box.left, (globalScope.innerWidth || 1024) - 312))}px`;
            node.style.top = `${Math.max(8, Math.min(box.bottom + 4, (globalScope.innerHeight || 768) - (node.offsetHeight || 260) - 8))}px`;
            rowEditor = { node, taskId: String(taskId), scope: captureScope(), trigger, returnSelector: `[data-action="${trigger.dataset.action}"]` };
            node.addEventListener('click', event => { if (event.target.closest('[data-close-editor]')) closeRowEditor(); });
            node.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRowEditor(); } });
            node.querySelector('input,select,button')?.focus();
            return rowEditor;
        }
        function beginRename(taskId) {
            if (!canWrite() || busy || !taskFor(taskId)) return;
            closePeoplePicker(); closeRowEditor(false);
            const key = draftKeyFor(taskId, 'title');
            renameSession = { taskId: String(taskId), scope: captureScope(), hadDraft: drafts.has(key), draft: drafts.get(key), base: draftBases.get(key), version: draftVersions.get(key) };
            if (!draftBases.has(key)) draftBases.set(key, Number(taskFor(taskId).revision || 0));
            renderVirtualRows(); focusRowControl(taskId, 'input[data-field-kind="title"]');
        }
        function finishRename(control, cancel) {
            const session = renameSession;
            if (!session || !scopeIsCurrent(session.scope)) return;
            const key = draftKeyFor(session.taskId, 'title');
            if (cancel) {
                if (session.hadDraft) { drafts.set(key, session.draft); draftBases.set(key, session.base); draftVersions.set(key, session.version); }
                else { drafts.delete(key); draftBases.delete(key); draftVersions.delete(key); }
                const version = dirtyField(session.scope, session.taskId, 'title');
                if (!session.hadDraft) emitFieldSave(session.scope, session.taskId, 'title', version, 'cancelled', { reason: 'edit-cancelled' });
                renameSession = null; renderVirtualRows(); focusRowControl(session.taskId); return;
            }
            // Keep the editor mounted until this exact draft receives its acknowledgement.
            const value = control.value;
            if (session.submitting && session.submittedValue === value) return;
            session.submitting = true; session.submittedValue = value;
            saveTaskField(session.taskId, 'title', control).then(lineage => {
                if (session.submittedValue === value) session.submitting = false;
                if (lineage && renameSession === session && scopeIsCurrent(session.scope) && control.value === value && !drafts.has(key)) {
                    const wasFocused = document.activeElement === control;
                    renameSession = null; renderVirtualRows(); if (wasFocused) focusRowControl(session.taskId);
                }
            });
        }
        function openDateRange(taskId, trigger) {
            const retained = effectiveField(taskId, 'dates');
            const range = retained || { startDate: effectiveField(taskId, 'startDate'), dueDate: effectiveField(taskId, 'dueDate') };
            const editor = openRowEditor(taskId, 'dates', trigger, `<label>Start <input type="date" name="startDate" value="${escape(range.startDate || '')}"></label><label>Due <input type="date" name="dueDate" value="${escape(range.dueDate || '')}"></label><p data-date-result role="status">Working days not confirmed</p><button type="button" data-preview-dates>Preview dates</button><button type="button" data-apply-dates disabled>Apply dates</button><button type="button" data-review-dates>Review saved dates</button><button type="button" data-rebase-dates hidden>Keep my dates</button><button type="button" data-discard-dates hidden>Discard draft</button>`);
            if (!editor) return;
            const key = draftKeyFor(taskId, 'dates');
            if (!draftBases.has(key)) draftBases.set(key, Number(taskFor(taskId).revision || 0));
            const read = () => ({ startDate: editor.node.querySelector('[name="startDate"]').value || null, dueDate: editor.node.querySelector('[name="dueDate"]').value || null });
            const message = editor.node.querySelector('[data-date-result]');
            let generation = 0, preview = null, applying = false, reviewed = null;
            const current = () => rowEditor === editor && scopeIsCurrent(editor.scope) && canWrite() && !busy;
            editor.node.addEventListener('input', () => { generation++; preview = null; editor.node.querySelector('[data-apply-dates]').disabled = true; drafts.set(key, read()); draftVersions.set(key, (draftVersions.get(key) || 0) + 1); dirtyField(editor.scope, taskId, 'dates'); message.textContent = 'Preview these dates before applying.'; });
            editor.node.addEventListener('click', async event => {
                if (!current() || applying) return;
                if (event.target.closest('[data-review-dates]')) {
                    const version = ++generation;
                    preview = null; reviewed = null;
                    editor.node.querySelector('[data-apply-dates]').disabled = true;
                    editor.node.querySelector('[data-rebase-dates]').hidden = true;
                    editor.node.querySelector('[data-discard-dates]').hidden = true;
                    message.textContent = 'Loading saved dates… Your draft is retained.';
                    try {
                        const response = await apiFetchJson(`/api/projects/${encodeURIComponent(editor.scope.projectId)}/tasks/${encodeURIComponent(taskId)}`);
                        if (!current() || version !== generation || refreshRequested()) return;
                        const observed = taskFor(taskId);
                        const latest = response?.task;
                        if (String(latest?.id) !== String(taskId) || !Number.isSafeInteger(latest?.revision)) throw new Error('Saved dates could not be confirmed.');
                        reviewed = Number(observed?.revision) > latest.revision ? observed : latest;
                        message.textContent = `Saved dates: ${reviewed.startDate || 'No start'} → ${reviewed.dueDate || 'No due'}. Keep your draft against this revision or discard it, then preview again.`;
                        editor.node.querySelector('[data-rebase-dates]').hidden = false;
                        editor.node.querySelector('[data-discard-dates]').hidden = false;
                    } catch (error) { if (current() && version === generation) message.textContent = error.message || 'Review failed. Your draft is retained.'; }
                } else if (reviewed && (event.target.closest('[data-rebase-dates]') || event.target.closest('[data-discard-dates]'))) {
                    generation++; preview = null;
                    editor.node.querySelector('[data-apply-dates]').disabled = true;
                    if (event.target.closest('[data-discard-dates]')) {
                        editor.node.querySelector('[name="startDate"]').value = reviewed.startDate || '';
                        editor.node.querySelector('[name="dueDate"]').value = reviewed.dueDate || '';
                    }
                    // Review changes only the draft base. A new preview and explicit Apply are mandatory.
                    draftBases.set(key, reviewed.revision);
                    drafts.set(key, read());
                    draftVersions.set(key, (draftVersions.get(key) || 0) + 1);
                    dirtyField(editor.scope, taskId, 'dates');
                    if (reviewed.revision >= Number(taskFor(taskId)?.revision || 0)) {
                        tasks.set(taskId, { ...taskFor(taskId), ...reviewed }); invalidateHierarchy();
                    }
                    reviewed = null;
                    editor.node.querySelector('[data-rebase-dates]').hidden = true;
                    editor.node.querySelector('[data-discard-dates]').hidden = true;
                    message.textContent = 'Draft ready for a new preview. Dates have not been applied.';
                } else if (event.target.closest('[data-preview-dates]')) {
                    const version = ++generation; preview = null; reviewed = null;
                    editor.node.querySelector('[data-rebase-dates]').hidden = true;
                    editor.node.querySelector('[data-discard-dates]').hidden = true;
                    editor.node.querySelector('[data-apply-dates]').disabled = true;
                    try {
                        const value = dateRange(read()); message.textContent = 'Preparing preview…';
                        // The calendar API requires two dates. Clearing remains one atomic task command.
                        if (!value.startDate || !value.dueDate) {
                            preview = { canApply: true, after: value };
                            message.textContent = 'Add both dates to preview working days. Apply to save this incomplete range.';
                            editor.node.querySelector('[data-apply-dates]').disabled = false;
                            return;
                        }
                        const response = await apiFetchJson(`/api/projects/${encodeURIComponent(editor.scope.projectId)}/schedule-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, expectedRevision: draftBases.get(key), ...value }) });
                        if (!current() || version !== generation) return;
                        preview = response?.preview;
                        if (!preview?.token || preview.taskId !== taskId || JSON.stringify(dateRange(preview.after || {})) !== JSON.stringify(value)) throw new Error('Preview could not be confirmed. Preview again.');
                        message.textContent = `${Number.isFinite(preview.workingDayCount) ? `${preview.workingDayCount} working days` : 'Working days not confirmed'}${asArray(preview.warnings).length ? ` · ${preview.warnings.map(w => w.message || w.code || 'Calendar warning').join(', ')}` : ''}${preview.canApply ? '' : ' · Resolve calendar configuration before applying.'}`;
                        editor.node.querySelector('[data-apply-dates]').disabled = !preview.canApply;
                    } catch (error) { if (current() && version === generation) message.textContent = `${error.message || 'Preview failed.'} Review saved dates to rebase or discard your retained draft.`; }
                } else if (event.target.closest('[data-apply-dates]') && preview?.canApply) {
                    const appliedGeneration = generation;
                    applying = true; editor.node.querySelector('[data-apply-dates]').disabled = true;
                    const lineage = await saveTaskField(taskId, 'dates', { value: read(), dataset: {}, schedulePreview: preview });
                    applying = false;
                    if (!current()) return;
                    if (lineage && generation === appliedGeneration) closeRowEditor();
                    else if (lineage) message.textContent = 'Previous dates saved. Preview your current dates before applying.';
                    else { preview = null; message.textContent = 'Dates were not confirmed. Draft retained. Review saved dates, then preview again.'; }
                }
            });
        }
        function openMoveEditor(taskId, trigger) {
            const task = taskFor(taskId);
            const parents = Array.from(tasks.values()).filter(t => t.id !== taskId && !asArray(t.ancestorIds || t.pathIds).includes(taskId) && (t.lifecycle || 'active') === 'active');
            const editor = openRowEditor(taskId, 'move', trigger, `<label>Section <select name="sectionId">${sections.map(s => `<option value="${escape(s.id)}"${s.id === (task.effectiveSectionId || task.sectionId) ? ' selected' : ''}>${escape(s.title || s.name)}</option>`).join('')}</select></label><label>Parent (loaded tasks) <select name="parentTaskId"><option value="">Root task</option>${parents.map(t => `<option value="${escape(t.id)}">${escape(t.title)}</option>`).join('')}</select></label><p role="status" data-move-result>Moves to the end of the selected branch.</p><button type="button" data-apply-move>Move task</button>`);
            if (!editor) return;
            editor.node.addEventListener('click', async event => {
                const button = event.target.closest('[data-apply-move]');
                if (!button || button.disabled || rowEditor !== editor || !scopeIsCurrent(editor.scope) || !canWrite()) return;
                button.disabled = true;
                const parentTaskId = editor.node.querySelector('[name="parentTaskId"]').value || null, sectionId = editor.node.querySelector('[name="sectionId"]').value;
                const index = parentTaskId ? await appendIndexForParent(parentTaskId, editor.scope) : rootsForSection(sectionId).filter(t => t.id !== taskId).length;
                if (index === null || rowEditor !== editor || !scopeIsCurrent(editor.scope) || !canWrite()) return;
                closeRowEditor(false); await moveTask(taskId, { parentTaskId, sectionId: parentTaskId ? null : sectionId, index });
                if (scopeIsCurrent(editor.scope)) focusRowControl(taskId);
            });
        }
        function openCustomField(taskId, column, trigger, source) {
            const editor = openRowEditor(taskId, 'field', trigger, '<label data-field-label></label><p data-field-result role="status"></p><button type="button" data-save-field>Save field</button>');
            if (!editor) return;
            editor.columnId = column.id; editor.columnType = column.type;
            const control = source.cloneNode(true), label = editor.node.querySelector('[data-field-label]');
            label.textContent = column.label || column.id; label.appendChild(control); control.focus();
            const key = draftKeyFor(taskId, `value:${column.id}`);
            if (!draftBases.has(key)) draftBases.set(key, Number(taskFor(taskId).revision || 0));
            let generation = 0, saving = false;
            const current = () => rowEditor === editor && scopeIsCurrent(editor.scope) && canWrite();
            control.addEventListener('input', () => { generation++; drafts.set(key, fieldValue(control)); draftVersions.set(key, (draftVersions.get(key) || 0) + 1); dirtyField(editor.scope, taskId, `value:${column.id}`); });
            const save = async () => {
                if (!current() || saving) return;
                saving = true; const version = generation; const button = editor.node.querySelector('[data-save-field]'); button.disabled = true;
                const lineage = await saveTaskField(taskId, 'value', control); saving = false;
                if (!current()) return;
                button.disabled = false;
                if (lineage && version === generation) closeRowEditor();
                else editor.node.querySelector('[data-field-result]').textContent = lineage ? 'Previous value saved. Current draft is unsaved.' : feedbackStore?.get(taskId, `value:${column.id}`)?.message || 'Value was not confirmed. Your draft is retained.';
            };
            editor.node.querySelector('[data-save-field]').addEventListener('click', save);
            control.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && control.tagName === 'INPUT') { event.preventDefault(); save(); } });
        }
        function openMenuField(taskId, key) {
            closeRowEditor(false);
            const inDetails = mobileList && !['status', 'ownerUid'].includes(key);
            if (inDetails) { selectedTaskId = taskId; renderDetail({ open: true }); }
            const host = inDetails ? elements.projectsBoardDetailBody : elements.projectsBoardRows;
            const row = host?.querySelector(`[data-task-id="${cssEscape(taskId)}"]`);
            const cell = Array.from(row?.children || []).find(node => node.dataset.columnKey === key);
            if (!cell || !canWrite()) return;
            if (key === 'dates') { openDateRange(taskId, cell.querySelector('[data-action="edit-dates"]')); return; }
            const status = cell.querySelector('[data-action="pick-status"]'), people = cell.querySelector('[data-action="pick-people"]');
            if (status) { openStatusPicker(status); return; }
            if (people) { openPeoplePicker(people); return; }
            const column = columns.find(c => `custom:${c.id}` === key), control = cell.querySelector('.crm-board-field');
            if (column && control && columnModel.supported(column.type)) openCustomField(taskId, column, control, control);
        }
        function handleRowEditorAction(action, row, event) {
            const taskId = row.dataset.taskId, trigger = event.target.closest('[data-action]');
            if (['save-rename', 'cancel-rename'].includes(action)) { finishRename(row.querySelector('input[data-field-kind="title"]'), action === 'cancel-rename'); return true; }
            if (action === 'edit-dates') { openDateRange(taskId, trigger); return true; }
            if (action === 'load-subtasks') { loadBranch(taskId, { append: true }); return true; }
            if (action !== 'task-menu') return false;
            const fieldActions = visibleColumns.filter(column => column.key !== 'taskTitle' && !column.readonly).map(column => `<button type="button" data-edit-field="${escape(column.key)}">Edit ${escape(column.label)}</button>`).join('');
            const editor = openRowEditor(taskId, 'menu', trigger, '<button type="button" data-rename-task>Rename (F2)</button><button type="button" data-add-child>Add subtask</button><button type="button" data-move-task>Move to…</button>' + fieldActions);
            editor?.node.addEventListener('click', e => {
                if (rowEditor !== editor || !scopeIsCurrent(editor.scope) || !canWrite()) return;
                if (e.target.closest('[data-rename-task]')) beginRename(taskId);
                else if (e.target.closest('[data-add-child]')) { closeRowEditor(false); openQuickComposer(taskId); }
                else if (e.target.closest('[data-move-task]')) openMoveEditor(taskId, trigger);
                else if (e.target.closest('[data-edit-field]')) openMenuField(taskId, e.target.closest('[data-edit-field]').dataset.editField);
            });
            return true;
        }
        function handleRowEditorKey(event) {
            if (event.defaultPrevented || event.isComposing) return true;
            const row = event.target.closest('[data-row-id]');
            if (!row) return false;
            if (event.target.matches('input[data-field-kind="title"]') && ['Enter', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); finishRename(event.target, event.key === 'Escape'); return true; }
            if (event.key === 'F2' && (event.target === row || event.target.matches('.crm-board-title-button'))) { event.preventDefault(); beginRename(row.dataset.taskId); return true; }
            if (event.target !== row) {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); focusNavigationRow(row.dataset.rowId); }
                return true; // Native controls own their editing keys.
            }
            if (!event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                if (row.dataset.rowKind === 'section') {
                    const collapsed = collapsedSections.has(row.dataset.sectionId);
                    if (collapsed === (event.key === 'ArrowRight')) row.querySelector('[data-action="toggle-section"]')?.click();
                } else if (mobileList) {
                    if (event.key === 'ArrowRight') { selectedTaskId = row.dataset.taskId; renderDetail({ open: true }); }
                } else {
                    const id = row.dataset.taskId, task = taskFor(id);
                    if (event.key === 'ArrowRight') {
                        if (hasPotentialChildren(task || {}) && !expanded.has(id)) toggleTask(id);
                        else { const child = logicalRows.find(r => r.task?.parentTaskId === id); if (child) focusNavigationRow(child.id); }
                    } else if (expanded.has(id)) toggleTask(id);
                    else if (task?.parentTaskId) focusNavigationRow(`task:${task.parentTaskId}`);
                }
                return true;
            }
            if (event.key === ' ' && row.dataset.taskId) { event.preventDefault(); toggleSelection(row.dataset.taskId); return true; }
            if (!event.altKey && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); const navigationRows = availableRows().filter(r => r.kind !== 'summary');
                const index = navigationRows.findIndex(r => r.id === row.dataset.rowId);
                const target = navigationRows[event.key === 'Home' ? 0 : event.key === 'End' ? navigationRows.length - 1 : Math.max(0, Math.min(navigationRows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
                if (target) focusNavigationRow(target.id);
                return true;
            }
            return false;
        }

        function fieldValue(control) {
            if (!control || typeof control !== 'object') return control ?? null;
            if (control.multiple) return Array.from(control.selectedOptions || []).map((option) => option.value).filter(Boolean);
            if (control.type === 'number') return control.value === '' ? null : Number(control.value);
            return control.value === '' ? null : control.value;
        }

        async function saveTaskField(taskId, kind, control) {
            const ctrl = control && typeof control === 'object' && ('value' in control || control.nodeType) ? control : { value: control, dataset: {} };
            let value = fieldValue(ctrl);
            const mutationScope = captureScope();
            const mutationProjectId = mutationScope.projectId;
            const columnId = ctrl.dataset?.columnId;
            const key = kind === 'value' && columnId ? `value:${columnId}` : kind;
            const uiEditVersion = dirtyField(mutationScope, taskId, key);
            if (presentationV2) {
                try { value = validateRowValue(taskId, kind, value, ctrl); }
                catch (error) { ctrl.setAttribute?.('aria-invalid', 'true'); emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'error', { message: error.message }); setStatus(error.message, 'error'); return; }
                ctrl.removeAttribute?.('aria-invalid');
            }
            if (refreshRequested()) {
                emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'cancelled', { reason: 'refresh-pending' });
                return;
            }
            const keyForDraft = draftKeyFor(taskId, key);
            const reviewGeneration = detailGeneration;
            if (remoteConflictReview?.key === keyForDraft) clearRemoteConflictReview();
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
                if (!scopeIsCurrent(mutationScope)) {
                    emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'cancelled', { reason: 'scope-changed' });
                    return;
                }
                const task = taskFor(taskId);
                if (!task || !canWrite()) {
                    emitFieldSave(mutationScope, taskId, key, uiEditVersion, task ? 'error' : 'cancelled', { reason: task ? 'write-unavailable' : 'task-unavailable' });
                    return;
                }
                // Only acknowledgments from this scoped local queue can advance a draft base.
                // A newer remotely observed task revision must still conflict and be reviewed.
                const followsLocal = predecessor?.bases?.includes(baseRevision) === true;
                const expectedRevision = followsLocal ? predecessor.revision : baseRevision;
                if (presentationV2) {
                    try { validateRowValue(taskId, kind, value, ctrl); }
                    catch (error) { emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'error', { message: error.message }); return; }
                }
                const patch = kind === 'value' && columnId ? { values: { [columnId]: value } } : kind === 'dates' && presentationV2 ? dateRange(value) : { [kind]: value };
                if (presentationV2 && kind === 'ownerUid' && value && asArray(task.assigneeUids).includes(value)) patch.assigneeUids = task.assigneeUids.filter(uid => uid !== value);
                const previous = { ...task, values: { ...(task.values || {}) } };
                const next = { ...task, ...patch, values: { ...(task.values || {}), ...(patch.values || {}) } };
                const opId = operationId(`edit-${taskId}`);
                const operationPendingKey = pendingKeyFor(mutationScope, taskId);
                const structural = ['parentTaskId', 'sectionId', 'rank', 'lifecycle'].includes(kind) ||
                    (currentGroupBy === 'status' && kind === 'status') ||
                    (currentGroupBy === 'ownerUid' && kind === 'ownerUid') ||
                    (currentGroupBy === 'priority' && (kind === 'priority' || (kind === 'value' && columnId === 'priority')));
                tasks.set(taskId, next);
                if (structural) invalidateHierarchy();
                else tasksVersion++;
                pending.set(operationPendingKey, opId);
                publishContext();
                const view = snapshotView();
                renderVirtualRows();
                try {
                    emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'saving', { operationId: opId });
                    const response = kind === 'dates' && presentationV2 && ctrl.schedulePreview?.token
                        ? await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/schedule-apply`, { operationId: opId, previewToken: ctrl.schedulePreview.token })
                        : await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}`, {
                            operationId: opId, expectedRevision, ...patch
                        }, { method: 'PATCH' });
                    if (!scopeIsCurrent(mutationScope)) {
                        emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'cancelled', { operationId: opId, reason: 'scope-changed' });
                        return;
                    }
                    const saved = response?.task || response?.result?.task;
                    if (!saved || String(saved.id) !== String(taskId) || !Number.isSafeInteger(saved.revision) || saved.revision <= expectedRevision) {
                        throw new Error('The save acknowledgement is incomplete. Refresh and review before retrying; your draft is retained.');
                    }
                    if (taskFor(taskId) && saved && Number(saved.revision) >= Number(taskFor(taskId).revision || 0)) {
                        tasks.set(taskId, { ...taskFor(taskId), ...saved });
                        if (structural) invalidateHierarchy();
                        else tasksVersion++;
                    }
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
                    emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'saved', { operationId: opId });
                    deps.onTaskMutation?.();
                    return lineage;
                } catch (error) {
                    if (!scopeIsCurrent(mutationScope)) {
                        emitFieldSave(mutationScope, taskId, key, uiEditVersion, 'cancelled', { operationId: opId, reason: 'scope-changed' });
                        return;
                    }
                    const phase = Number(error?.status) === 409 ? 'conflict' : (!error?.status || Number(error.status) >= 500) ? 'uncertain' : 'error';
                    emitFieldSave(mutationScope, taskId, key, uiEditVersion, phase, { operationId: opId, message: error.message || 'The change could not be confirmed.' });
                    if (tasks.get(taskId) === next) {
                        tasks.set(taskId, previous);
                        if (structural) invalidateHierarchy();
                        else tasksVersion++;
                    }
                    setStatus(error?.message || 'Task save failed. Your draft is retained.', 'error');
                    if (kind !== 'dates' && Number(error?.status) === 409 && elements.projectsBoardStatus && (!presentationV2 || reviewGeneration === detailGeneration)) {
                        clearRemoteConflictReview();
                        const review = document.createElement('button'); review.type = 'button'; review.className = 'crm-btn-secondary crm-btn-sm'; review.textContent = 'Review and retry'; review.dataset.remoteConflictReview = taskId;
                        const recovery = { node: review, taskId, key: keyForDraft, scope: mutationScope, generation: reviewGeneration };
                        remoteConflictReview = recovery;
                        const current = () => remoteConflictReview === recovery && scopeIsCurrent(mutationScope) && !refreshRequested() && canWrite() && taskFor(taskId) && drafts.has(keyForDraft) && (!presentationV2 || detailGeneration === reviewGeneration);
                        review.addEventListener('click', async () => {
                            if (review.disabled || !current()) return;
                            review.disabled = true;
                            try {
                                const latest = await apiFetchJson(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}`);
                                if (!current()) return;
                                if (String(latest?.task?.id) !== String(taskId) || !Number.isSafeInteger(latest.task.revision)) throw new Error('The current task could not be verified. Your draft is retained.');
                                const observed = taskFor(taskId);
                                const reviewedTask = Number(observed?.revision || 0) > Number(latest.task.revision || 0) ? observed : latest.task;
                                const currentValue = kind === 'value' ? reviewedTask.values?.[columnId] : reviewedTask[kind];
                                if (!globalScope.confirm(`Current saved value: ${JSON.stringify(currentValue ?? '')}\n\nSave your retained draft instead?`)) return;
                                const retained = drafts.get(keyForDraft);
                                if (retained === undefined || !current()) return;
                                if (Number(reviewedTask.revision || 0) >= Number(taskFor(taskId)?.revision || 0)) {
                                    tasks.set(taskId, { ...taskFor(taskId), ...reviewedTask });
                                    invalidateHierarchy();
                                }
                                draftBases.set(keyForDraft, reviewedTask.revision);
                                const retryControl = { dataset: { ...ctrl.dataset }, value: retained, type: ctrl.type, multiple: Array.isArray(retained), selectedOptions: Array.isArray(retained) ? retained.map(value => ({ value })) : [] };
                                clearRemoteConflictReview();
                                await saveTaskField(taskId, kind, retryControl);
                            } catch (failure) { if (scopeIsCurrent(mutationScope)) setStatus(failure.message || 'Review failed. Your draft is retained.', 'error'); }
                            finally {
                                if (current()) review.disabled = false;
                                else if (remoteConflictReview === recovery) clearRemoteConflictReview();
                            }
                        });
                        mountRemoteConflictReview();
                    }
                } finally {
                    if (pending.get(operationPendingKey) === opId) pending.delete(operationPendingKey);
                    if (scopeIsCurrent(mutationScope)) {
                        const completionView = presentationV2 ? snapshotView() : view;
                        if (presentationV2) {
                            // Field edits do not change schema/settings or section forms.
                            publishContext(); renderVirtualRows(); renderDetail(); renderBatchDock(); mountRemoteConflictReview();
                        } else renderBoard();
                        restoreView(completionView);
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
            if (!canSchema() || busy || sectionCreatePending || batchRun?.pending || [...creationIntents.values()].some(i => i.phase === 'uncertain')) return;
            const title = String(elements.projectsBoardSectionName?.value || '').trim();
            if (!title || title.length > 200) {
                setStatus('Enter a section name (up to 200 characters).', 'error');
                elements.projectsBoardSectionName?.focus();
                return;
            }
            const scope = captureScope();
            const intent = sectionIntent || { id: operationId('section-create'), scope, payload: null };
            sectionIntent = intent; sectionCreatePending = true;
            syncSectionForm();
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
            if (!presentationV2) resetSectionForm();
            renderBoard();

            sectionCreateQueue = taskCreateQueue = taskCreateQueue.catch(() => {}).then(async () => {
                try {
                    if (!scopeIsCurrent(scope)) return;
                    if (!canSchema()) throw Object.assign(new Error('Section permission changed.'), { status: 403 });
                    intent.payload ||= {
                        operationId: intent.id,
                        title,
                        index: targetIndex,
                        expectedStructureRevision: structureRevision()
                    };
                    const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/sections`, intent.payload, { scope, schema: true });
                    if (!scopeIsCurrent(scope)) return;
                    if (!canSchema()) throw Object.assign(new Error('Section permission changed.'), { status: 403 });
                    const created = response?.section || response?.result?.section;
                    if (created?.id && Number.isFinite(Number(created.revision))) {
                        sectionIntent = null; resetSectionForm();
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

                        if (quickTaskAfterSection && scopeIsCurrent(quickTaskAfterSection) && canSchema()) {
                            quickTaskAfterSection = false;
                            if (presentationV2) openQuickComposer(null, created.id);
                            else createTask(null, created.id);
                        }

                        if (pendingDrafts.title && pendingDrafts.title !== created.title) {
                            saveSection(created.id, { value: pendingDrafts.title });
                        }
                    } else { throw new Error('Section acknowledgement is unconfirmed. Retry the same creation.'); }
                } catch (error) {
                    if (!scopeIsCurrent(scope)) return;
                    if (error.status && Number(error.status) < 500) sectionIntent = null;
                    sections = sections.filter((s) => s.id !== optId);
                    renderBoard();
                    if (canSchema()) {
                        if (elements.projectsBoardSectionName) elements.projectsBoardSectionName.value = title;
                        if (elements.projectsBoardSectionForm) elements.projectsBoardSectionForm.hidden = false;
                    }
                    setStatus(error?.message || 'Section could not be created.', 'error');
                } finally {
                    if (scopeIsCurrent(scope)) { sectionCreatePending = false; syncSectionForm(); }
                }
            });
            await sectionCreateQueue;
            return sections.find((s) => String(s.id) === String(optimisticSectionIdMap.get(optId) || optId));
        }

        let taskCreateQueue = Promise.resolve();
        const optimisticIdMap = new Map();

        async function createTask(parentTaskId = null, explicitSectionId = null, options = {}) {
            if (refreshRequested()) return;
            if (!canWrite() || batchRun?.pending || batchRun?.items.some(i => i.phase === 'uncertain')) return;
            if ([...creationIntents.values()].some(i => i.phase === 'uncertain' && i.id !== options.intentId)) {
                paintLegacyCreationRecovery();
                setStatus('Resolve the unconfirmed creation using Retry same creation before adding another task.', 'error');
                return;
            }
            const replay = creationIntents.get(options.intentId)?.payload;
            const initialTitle = String(replay?.title ?? options.initialTitle ?? 'New task').trim();
            if (!initialTitle || initialTitle.length > 200) { setStatus('Enter a task title (up to 200 characters).', 'error'); return; }
            const scope = captureScope();
            const intentKey = options.intentId || operationId('task-create');
            let intent = creationIntents.get(intentKey);
            if (intent && (!scopeIsCurrent(intent.scope) || intent.phase === 'saving')) return;
            if (!intent) intent = { id: intentKey, scope, phase: 'draft', payload: null, temporaryIds: [] };
            creationIntents.set(intentKey, intent);
            const resolvedParentTaskId = replay ? replay.parentTaskId : parentTaskId ? (optimisticIdMap.get(parentTaskId) || parentTaskId) : null;
            const rawSectionId = replay ? replay.sectionId : resolvedParentTaskId ? resolveEffectiveSectionId(resolvedParentTaskId) : (explicitSectionId || resolveEffectiveSectionId(selectedTaskId) || sections[0]?.id);
            const sectionId = optimisticSectionIdMap.get(rawSectionId) || rawSectionId;
            // A retained operation must reach the canonical receipt check even if its parent
            // or section is no longer loaded. Query membership cannot disprove a prior write.
            if (!replay && (!sectionId || !sections.some(s => String(s.id) === String(sectionId)) || resolvedParentTaskId && !taskFor(resolvedParentTaskId))) { creationIntents.delete(intentKey); showToast('Choose an available parent and real section.', 'error'); return; }
            creationFeedback(intent, 'saving');

            const optId = `opt-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            intent.temporaryIds.push(optId);
            const parent = resolvedParentTaskId ? taskFor(resolvedParentTaskId) : null;
            const optTask = {
                id: optId,
                projectId: scope.projectId,
                title: initialTitle,
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
            invalidateHierarchy();
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

            renderBoard({ focusRowId: options.keepComposerFocus ? '' : `task:${optId}` });
            const optRow = elements.projectsBoardRows?.querySelector(`[data-task-id="${cssEscape(optId)}"]`);
            const titleInput = options.keepComposerFocus ? null : (optRow?.querySelector('[data-field-kind="title"]') || optRow?.querySelector('.crm-board-title-button') || optRow);
            titleInput?.focus?.();
            titleInput?.select?.();

            const sectionDependency = sectionCreateQueue;
            taskCreateQueue = taskCreateQueue.catch(() => {}).then(async () => {
                try {
                    if (!scopeIsCurrent(scope)) return;
                    if ([...creationIntents.values()].some(other => other !== intent && other.phase === 'uncertain') || sectionIntent && !sectionCreatePending) throw Object.assign(new Error('Resolve the preceding unconfirmed creation first.'), { status: 409 });
                    if (!canWrite()) throw Object.assign(new Error('Creation permission changed.'), { status: 403 });
                    if (sectionId && (String(sectionId).startsWith('opt-sec-') || sections.some(s => s.id === sectionId && s.isOptimistic))) {
                        await sectionDependency;
                        if (!scopeIsCurrent(scope)) return;
                    }
                    const effectiveParentId = resolvedParentTaskId ? (optimisticIdMap.get(resolvedParentTaskId) || resolvedParentTaskId) : null;
                    if (!intent.payload && resolvedParentTaskId && String(resolvedParentTaskId).startsWith('opt-task-') && !optimisticIdMap.has(resolvedParentTaskId)) {
                        tasks.delete(optId);
                        invalidateHierarchy();
                        renderBoard();
                        throw Object.assign(new Error('Parent task failed to save. Subtask text is retained.'), { status: 409 });
                    }
                    const targetSectionId = optimisticSectionIdMap.get(sectionId) || sectionId;
                    if (!intent.payload && !sections.some(s => String(s.id) === String(targetSectionId) && !s.isOptimistic)) {
                        tasks.delete(optId);
                        invalidateHierarchy();
                        renderBoard();
                        throw Object.assign(new Error('Section failed to save. Task text is retained.'), { status: 409 });
                    }
                    const targetIndex = effectiveParentId
                        ? childrenOf(effectiveParentId).filter(t => t.id !== optId && !t.isOptimistic).length
                        : rootsForSection(targetSectionId).filter(t => t.id !== optId && !t.isOptimistic).length;

                    if (!canWrite()) throw Object.assign(new Error('Creation is no longer permitted.'), { status: 403 });
                    intent.payload ||= {
                        operationId: intentKey, title: initialTitle, parentTaskId: effectiveParentId || null, sectionId: targetSectionId, index: targetIndex, expectedStructureRevision: structureRevision()
                    };
                    const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/tasks`, intent.payload, { scope });
                    if (!scopeIsCurrent(scope)) return;
                    if (!canWrite()) throw Object.assign(new Error('Creation permission changed.'), { status: 403 });
                    const created = response?.task || response?.result?.task;
                    const activeEl = document.activeElement;
                    const hadFocusInOpt = activeEl && activeEl.closest?.(`[data-task-id="${cssEscape(optId)}"]`);
                    const fieldKind = hadFocusInOpt ? activeEl.getAttribute('data-field-kind') : null;
                    const shouldFocus = !!hadFocusInOpt || !options.keepComposerFocus && !operation.moved && (!document.activeElement || document.activeElement === operation.trigger || document.activeElement === document.body);

                    if (created?.id && Number.isFinite(Number(created.revision))) {
                        for (const temporaryId of intent.temporaryIds) optimisticIdMap.set(temporaryId, created.id);
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

                        if (selectedTaskId === optId) {
                            selectedTaskId = String(created.id);
                            if (detailOpenIntent?.taskId === optId && scopeIsCurrent(detailOpenIntent.scope)) {
                                detailOpenIntent.taskId = String(created.id);
                            }
                            detailSurface?.replaceTaskId(optId, created.id);
                            if (lastDetailTaskId === optId) lastDetailTaskId = String(created.id);
                        }
                        const selIdx = selectedTaskIds.indexOf(optId);
                        if (selIdx !== -1) selectedTaskIds[selIdx] = String(created.id);

                        if (expanded.delete(optId)) expanded.add(String(created.id));
                        if (focusedRowId === `task:${optId}`) focusedRowId = `task:${created.id}`;
                        for (const child of tasks.values()) {
                            if (intent.temporaryIds.includes(child.parentTaskId)) child.parentTaskId = String(created.id);
                            if (child.ancestorIds) child.ancestorIds = child.ancestorIds.map(id => intent.temporaryIds.includes(id) ? String(created.id) : id);
                            if (child.pathIds) child.pathIds = child.pathIds.map(id => intent.temporaryIds.includes(id) ? String(created.id) : id);
                        }
                        stateModel?.setSelectedTaskIds?.(selectedTaskIds);
                        tasks.delete(optId);
                        if (!created.effectiveSectionId) created.effectiveSectionId = targetSectionId;
                        tasks.set(String(created.id), created);
                        invalidateHierarchy();
                        settleComposerParent(intent.temporaryIds, created, scope);

                        boardRevision.structureRevision = Math.max(structureRevision(), Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision));
                        if (effectiveParentId) expanded.add(String(effectiveParentId));

                        creationFeedback(intent, 'saved', { temporaryId: optId, taskId: String(created.id) });
                        creationIntents.delete(intentKey);
                        renderBoard({ focusRowId: shouldFocus ? `task:${created.id}` : '' });
                        const newRow = elements.projectsBoardRows?.querySelector(`[data-task-id="${cssEscape(created.id)}"]`);
                        if (shouldFocus) {
                            if (fieldKind) {
                                const field = newRow?.querySelector(`[data-field-kind="${cssEscape(fieldKind)}"]`);
                                field?.focus?.();
                            } else {
                                const title = newRow?.querySelector('[data-field-kind="title"]') || newRow?.querySelector('.crm-board-title-button') || newRow;
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
                    } else { throw new Error('Creation acknowledgement is unconfirmed.'); }
                } catch (error) {
                    if (!scopeIsCurrent(scope)) return;
                    const uncertain = !error?.status || Number(error.status) >= 500;
                    creationFeedback(intent, uncertain ? 'uncertain' : 'failed', { temporaryId: optId });
                    if (!uncertain) creationIntents.delete(intentKey);
                    tasks.delete(optId);
                    invalidateHierarchy();
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
                    if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) invalidateAccess(currentProjectId());
                    else if (scopeIsCurrent(scope)) syncTaskCreation();
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

        // Both single-row and batch moves consume persisted fields, then derive the loaded tree.
        function reconcileTaskMove(taskId, destination, result) {
            boardRevision.structureRevision = Math.max(structureRevision(), Number(result?.structureRevision ?? structureRevision()));
            const task = taskFor(taskId);
            if (!task || result?.task && Number(task.revision) > Number(result.task.revision)) return;
            const saved = result?.task;
            const destParent = destination.parentTaskId ? taskFor(destination.parentTaskId) : null;
            const effectiveSec = destination.parentTaskId ? resolveEffectiveSectionId(destination.parentTaskId) : destination.sectionId;
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
                sectionId: destination.parentTaskId ? null : destination.sectionId,
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
            invalidateHierarchy();
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
                expandDestinationAncestry(destination);
                selectedTaskId = String(taskId);
                reconcileTaskMove(taskId, { parentTaskId: destParentTaskId, sectionId: destSectionId }, response?.result || response);
                await loadProject(mutationProjectId, { preserve: true });
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
            if (!id || (presentationV2 && !hasPotentialChildren(taskFor(id) || {}))) return;
            if (expanded.has(id)) { expanded.delete(id); renderBoard(); return; }
            expanded.add(id);
            renderBoard();
            const scope = captureScope(), sequence = refreshSequence;
            const current = () => scopeIsCurrent(scope) && sequence === refreshSequence && !busy;
            if (presentationV2 && !loadedBranches.has(id)) {
                branchLoading.add(id); renderVirtualRows();
                try { if (!await loadBranch(id)) return; }
                finally { branchLoading.delete(id); if (scopeIsCurrent(scope)) renderVirtualRows(); }
            } else if (!loadedBranches.has(id) && !await loadAllBranch(id)) return;
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
                    if (!await (presentationV2 ? loadBranch(childId) : loadAllBranch(childId))) return;
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
        let detailSurface = null, detailDiscussionKey = '';
        let detailGeneration = 0, remoteConflictReview = null;
        function clearRemoteConflictReview() {
            remoteConflictReview?.node.remove();
            remoteConflictReview = null;
        }
        function mountRemoteConflictReview() {
            const recovery = remoteConflictReview;
            if (!recovery) return;
            if (!scopeIsCurrent(recovery.scope) || !canWrite() || !drafts.has(recovery.key) || (presentationV2 && recovery.generation !== detailGeneration)) { clearRemoteConflictReview(); return; }
            // Move the one canonical action into the native dialog's active tree.
            // Keep it outside tab panels and Overview's replaceable field host.
            if (detailSurface && String(selectedTaskId) === String(recovery.taskId)) {
                elements.projectsBoardDetail.querySelector('.crm-projects-board-detail-head')?.after(recovery.node);
            } else elements.projectsBoardStatus?.append(recovery.node);
        }
        const detailRemovers = [];
        function clearDetailPresentation(restore = false) {
            if (!detailSurface && globalScope.CrmProjectsDetailSurfaceV2?.hasOwner(elements.projectsBoardDetail)) return;
            if (!lastDetailTaskId && !elements.projectsBoardDetail?.open) return;
            detailDiscussionKey = ''; detailChildren = null;
            detailGeneration++; clearRemoteConflictReview();
            closePeoplePicker(); closeStatusPicker(); closeRowEditor(false); globalScope.CrmProjectsDatePicker?.close();
            selectedTaskId = ''; lastDetailTaskId = null;
            detailSurface?.forceClose({ clear: true, restore });
            if (elements.projectsBoardDetailBody) elements.projectsBoardDetailBody.replaceChildren();
            if (elements.projectsBoardDetailTitle) elements.projectsBoardDetailTitle.textContent = '';
            document.getElementById('projects-task-planning')?.replaceChildren();
            globalScope.CrmProjectsDiscussion?.setSelection(null);
            deps.onTaskSelection?.(null);
        }
        function canRestoreDetailFocus(taskId, scope) {
            const task = taskFor(taskId);
            return scopeIsCurrent(scope) && !authorityPending && hasProject() && String(project.id) === currentProjectId()
                && String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid && (project.lifecycle || 'active') === 'active'
                && !!task && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active';
        }
        function restoreDetailFocus(taskId, scope) {
            if (!canRestoreDetailFocus(taskId, scope)) {
                const heading = document.getElementById('projects-workspace-name');
                heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); return;
            }
            const viewContent = document.getElementById('projects-view-content');
            if (viewContent && !viewContent.hidden) {
                const opener = Array.from(viewContent.querySelectorAll('[data-task-open]')).find(node => node.dataset.taskOpen === String(taskId));
                const target = opener || document.getElementById('projects-workspace-name');
                if (!opener) target?.setAttribute('tabindex', '-1');
                target?.focus({ preventScroll: true }); return;
            }
            renderVirtualRows();
            const row = logicalRows.find(entry => String(entry.task?.id) === String(taskId));
            if (row && elements.projectsBoardScroll) {
                elements.projectsBoardScroll.scrollTop = row.index * ROW_HEIGHT;
                renderVirtualRows({ focusRowId: row.id }); focusRowControl(taskId);
                // Mobile rows flow at their content height; the table's fixed-row
                // estimate mounts the target but cannot ensure it is in view.
                if (mobileList) document.activeElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
                return;
            }
            const heading = document.getElementById('projects-workspace-name');
            heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true });
        }
        let detailChildren = null;
        function renderDetailChildren(task) {
            const body = elements.projectsBoardDetailBody;
            let region = body.querySelector('[data-detail-children]');
            if (!region) {
                region = document.createElement('section'); region.dataset.detailChildren = '';
                region.setAttribute('aria-label', 'Subtasks');
                region.innerHTML = '<button type="button" data-detail-parent></button><button type="button" data-detail-children-previous>Show earlier loaded subtasks</button><ul aria-label="Existing subtasks" data-detail-child-list></ul><p role="status" data-detail-children-status></p><button type="button" data-detail-children-more></button>';
                body.querySelector('[data-detail-add]').before(region);
            }
            region.hidden = !mobileList;
            if (!mobileList) return;
            const id = String(task.id);
            if (!detailChildren || detailChildren.id !== id || detailChildren.generation !== detailGeneration || !detailChildren.current()) {
                const scope = captureScope(), sequence = refreshSequence, query = filterGeneration, authority = authorityRevision;
                const state = { id, generation: detailGeneration, limit: 50, pending: false, error: false };
                state.current = () => detailChildren === state && scopeIsCurrent(scope) && sequence === refreshSequence && query === filterGeneration
                    && authority === authorityRevision && !authorityPending && selectedTaskId === id && state.generation === detailGeneration;
                detailChildren = state;
            }
            const state = detailChildren;
            const navigate = (nextId, returnChild = '') => {
                if (!state.current() || busy || !taskFor(nextId)) return;
                closePeoplePicker(); closeStatusPicker(); closeRowEditor(false); globalScope.CrmProjectsDatePicker?.close();
                selectedTaskId = String(nextId); renderDetail({ open: true, preserveOrigin: true });
                const returnIndex = returnChild ? childrenOf(nextId).findIndex(child => String(child.id) === returnChild) : -1;
                if (returnIndex >= detailChildren.limit || returnIndex >= 0 && returnIndex < detailChildren.limit - MOBILE_WINDOW) { detailChildren.limit = Math.ceil((returnIndex + 1) / 50) * 50; renderDetailChildren(taskFor(nextId)); }
                if (!returnChild) elements.projectsBoardDetail.scrollTop = 0;
                const target = returnChild && Array.from(body.querySelectorAll('[data-detail-child]')).find(node => node.dataset.detailChild === returnChild);
                (target || elements.projectsBoardDetailTitle)?.focus();
            };
            const parent = taskFor(task.parentTaskId), back = region.querySelector('[data-detail-parent]');
            back.hidden = !parent; back.disabled = busy || !state.current();
            back.textContent = parent ? `Back to parent: ${parent.title || 'Untitled task'}` : '';
            back.onclick = () => { if (parent) navigate(parent.id, id); };
            const children = childrenOf(id).filter(child => (child.effectiveLifecycle || child.lifecycle || 'active') === 'active');
            const list = region.querySelector('[data-detail-child-list]');
            const firstChild = Math.max(0, state.limit - MOBILE_WINDOW);
            const markup = children.slice(firstChild, state.limit).map(child => `<li><button type="button" data-detail-child="${escape(child.id)}" aria-label="Open subtask: ${escape(child.title || 'Untitled task')}"${busy || !state.current() ? ' disabled' : ''}>${escape(child.title || 'Untitled task')}</button></li>`).join('');
            if (list.innerHTML !== markup) list.innerHTML = markup;
            list.onclick = event => { const button = event.target.closest('[data-detail-child]'); if (button && !button.disabled && list.contains(button)) navigate(button.dataset.detailChild); };
            const earlier = region.querySelector('[data-detail-children-previous]');
            earlier.hidden = !firstChild; earlier.disabled = state.pending || busy || !state.current();
            earlier.onclick = () => { if (!state.current() || state.pending || busy) return; state.limit = Math.max(50, state.limit - MOBILE_WINDOW); renderDetailChildren(task); list.querySelector('[data-detail-child]')?.focus(); };
            const more = region.querySelector('[data-detail-children-more]'), status = region.querySelector('[data-detail-children-status]');
            const unloaded = !loadedBranches.has(id) && hasPotentialChildren(task);
            more.hidden = !state.error && !unloaded && children.length <= state.limit && !branchHasMore.get(id);
            more.disabled = state.pending || busy || !state.current();
            more.textContent = state.error ? 'Retry loading subtasks' : children.length > state.limit ? 'Show more loaded subtasks' : 'Load more subtasks';
            status.textContent = state.pending ? 'Loading subtasks…' : state.error ? 'Subtasks could not be loaded. Retry to continue.' : children.length ? `Showing ${firstChild + 1}–${Math.min(children.length, state.limit)} of ${children.length} loaded subtasks` : unloaded ? '' : 'No subtasks';
            const load = async (focusNext = false) => {
                if (!state.current() || state.pending || busy) return;
                const previousCount = Math.min(children.length, state.limit);
                if (children.length > state.limit) {
                    state.limit += 50; renderDetailChildren(task);
                } else {
                    state.pending = true; state.error = false; renderDetailChildren(task);
                    const loaded = await loadBranch(id, { append: loadedBranches.has(id), render: false });
                    if (loaded) invalidateHierarchy();
                    if (!state.current()) return;
                    state.pending = false; state.error = !loaded;
                    if (loaded && focusNext && previousCount >= state.limit) state.limit += 50;
                    renderDetailChildren(taskFor(id));
                }
                if (focusNext && state.current()) {
                    const next = list.querySelectorAll('[data-detail-child]')[previousCount - Math.max(0, state.limit - MOBILE_WINDOW)];
                    (next || more)?.focus();
                }
            };
            more.onclick = () => { void load(true); };
            if (unloaded && !state.pending && !state.error && !busy && state.current()) void load();
        }
        function renderOverview(task) {
            const body = elements.projectsBoardDetailBody;
            if (!body) return;
            let fields = body.querySelector('[data-detail-fields]');
            if (!fields || fields.dataset.taskId !== String(task.id)) {
                body.replaceChildren(); fields = document.createElement('div'); fields.dataset.detailFields = '';
                fields.dataset.taskId = task.id; fields.dataset.rowId = `task:${task.id}`; fields.dataset.rowKind = 'task';
                fields.className = 'crm-detail-fields'; body.append(fields);
                const path = document.createElement('p'); path.dataset.detailPath = ''; body.append(path);
                const subtasks = document.createElement('p'); subtasks.dataset.detailSubtasks = ''; body.append(subtasks);
                const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Add subtask'; add.dataset.detailAdd = '';
                add.addEventListener('click', () => { if (selectedTaskId !== String(task.id) || !canWrite()) return; detailSurface?.requestClose(); openQuickComposer(task.id); }); body.append(add);
            }
            const template = document.createElement('template');
            template.innerHTML = taskRowMarkup({ kind: 'task', id: `task:${task.id}`, task, depth: 0, index: 0 });
            const cells = Array.from(template.content.firstElementChild.children);
            const title = cells.find(cell => cell.dataset.columnKey === 'taskTitle');
            title.innerHTML = `<input class="crm-board-field" data-field-kind="title" type="text" maxlength="200" aria-label="Task title" value="${escape(effectiveField(task.id, 'title') || task.title)}"${canWrite() && !busy ? '' : ' disabled'}>`;
            const keys = new Set();
            for (const fresh of cells) {
                const key = fresh.dataset.columnKey; keys.add(key);
                fresh.setAttribute('role', 'group');
                const descriptor = key.startsWith('custom:') ? columns.find(column => `custom:${column.id}` === key) : null;
                const labels = { taskTitle: 'Task title', status: 'Status', ownerUid: 'Owner', assigneeUids: 'Collaborators', dates: 'Dates' };
                const label = document.createElement('span'); label.className = 'crm-detail-field-label'; label.textContent = descriptor?.label || labels[key] || key; fresh.prepend(label); fresh.setAttribute('aria-label', label.textContent);
                fresh.querySelectorAll('[data-column-id]').forEach(control => { control.dataset.columnType = descriptor?.type || ''; });
                const old = Array.from(fields.children).find(cell => cell.dataset.columnKey === key);
                const pinned = [rowEditor, peopleContext, statusContext].some(context => old?.contains(context?.trigger));
                if (old && canWrite() && !busy && (pinned || canPreserveFocusedEditor(old, fresh, document.activeElement))) continue;
                if (old) { if (old.innerHTML !== fresh.innerHTML) old.replaceWith(fresh); }
                else fields.append(fresh);
            }
            Array.from(fields.children).forEach(cell => { if (!keys.has(cell.dataset.columnKey)) cell.remove(); });
            body.querySelector('[data-detail-path]').textContent = `Parent path: ${asArray(task.pathIds).map(id => taskFor(id)?.title || id).join(' → ') || 'Root task'}`;
            const derived = task.derived;
            body.querySelector('[data-detail-subtasks]').textContent = derived?.activeLeafCount != null ? `Subtasks: ${derived.completedLeafCount ?? 0} / ${derived.activeLeafCount} leaves complete` : `Subtasks: ${Number(task.activeChildCount || 0)} direct children`;
            body.querySelector('[data-detail-add]').hidden = !canWrite();
            paintFieldFeedback(task.id, fields);
            renderDetailChildren(task);
        }
        let statusPopover = null;
        let statusContext = null;

        function closeStatusPicker() {
            if (!statusPopover) return;
            statusContext?.trigger?.setAttribute('aria-expanded', 'false');
            statusPopover.remove();
            statusPopover = null;
            statusContext = null;
        }

        function syncStatusElement(control, newStatus, labels = {}) {
            if (!control) return;
            const status = newStatus || control.value || 'not_started';
            control.value = status;
            control.setAttribute('data-status', status);
            const cell = control.closest('[data-column-key], [role="cell"]');
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
            const { control, trigger, labels, taskId, fieldKind, columnId, scope } = statusContext;
            if (presentationV2 && (!scopeIsCurrent(scope) || !canWrite() || busy)) { closeStatusPicker(); return; }
            closeStatusPicker();
            if (!control || control.disabled) return;
            if (presentationV2) trigger.focus({ preventScroll: true });
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
            if (presentationV2) { closeRowEditor(false); if (!canWrite() || busy) return; }
            closeStatusPicker();
            closePeoplePicker();
            const cell = trigger.closest('[data-column-key], [role="cell"]');
            const row = trigger.closest('[data-task-id]');
            const control = cell?.querySelector('.crm-board-field');
            if (!control || control.disabled || !row) return;

            const taskId = row.dataset.taskId;
            const fieldKind = control.dataset.fieldKind;
            const columnId = control.dataset.columnId;
            const current = control.value || trigger.dataset.status || 'not_started';
            const column = columnId ? columns.find((c) => String(c.id) === String(columnId)) : null;
            const labels = (fieldKind === 'status' ? project?.statusLabels : column?.statusLabels) || {};

            statusContext = { control, trigger, labels, taskId, fieldKind, columnId, current, scope: captureScope(), columnType: column?.type };

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
            (trigger.closest('dialog[open]') || panel || document.body).appendChild(statusPopover);

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

            trigger.setAttribute('aria-expanded', 'true');
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
                    event.preventDefault(); event.stopPropagation();
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
            const excluded = presentationV2 && peopleContext?.control.dataset.fieldKind === 'assigneeUids' && uid && effectiveField(peopleContext.taskId, 'ownerUid') === uid;
            const secondary = person.displayName && person.email ? escape(person.email) : '';
            return `<button type="button" role="option" aria-selected="${chosen ? 'true' : 'false'}" class="crm-people-option${chosen ? ' is-chosen' : ''}" data-people-uid="${escape(uid)}"${excluded ? ' disabled title="Already the accountable owner"' : ''}>`
                + `<span class="crm-board-owner-avatar" aria-hidden="true">${escape(ownerInitials(uid))}</span>`
                + `<span class="crm-people-option-text"><span class="crm-people-option-name">${escape(name)}</span>`
                + (secondary ? `<span class="crm-people-option-mail">${secondary}</span>` : '')
                + '</span><span class="crm-people-option-tick" aria-hidden="true"></span></button>';
        }

        function renderPeopleOptions(query) {
            if (!peoplePopover || !peopleContext) return;
            const term = String(query || '').trim().toLowerCase();
            const chosen = new Set(peopleContext.selected);
            const available = presentationV2 ? [...members, ...peopleContext.selected.filter(uid => !members.some(p => p.uid === uid)).map(uid => ({ uid, displayName: `${uid} (unavailable)` }))] : members;
            const matches = available.filter((person) => {
                if (!term) return true;
                const name = asText(person.displayName || '').toLowerCase();
                const mail = asText(person.email || '').toLowerCase();
                return name.includes(term) || mail.includes(term);
            });
            const list = peoplePopover.querySelector('[data-people-list]');
            if (!list) return;
            const activeUid = presentationV2 && list.contains(document.activeElement) ? document.activeElement.dataset.peopleUid : null;
            const none = peopleContext.multiple
                ? ''
                : peopleRowMarkup({ uid: '', displayName: 'Unassigned' }, !peopleContext.selected.length);
            list.innerHTML = none + (matches.length
                ? matches.map((person) => peopleRowMarkup(person, chosen.has(String(person.uid)))).join('')
                : '<p class="crm-people-empty">No members match.</p>');
            if (activeUid !== null) list.querySelector(`[data-people-uid="${cssEscape(activeUid)}"]:not(:disabled)`)?.focus({ preventScroll: true });
        }

        async function reloadPeopleSelection() {
            const context = peopleContext;
            if (!context || context.saving || context.reloading || !scopeIsCurrent(context.scope) || !canWrite() || busy || refreshRequested()) return;
            context.reloading = true;
            try {
                const response = await apiFetchJson(`/api/projects/${encodeURIComponent(context.scope.projectId)}/tasks/${encodeURIComponent(context.taskId)}`);
                if (peopleContext !== context || !scopeIsCurrent(context.scope) || !canWrite() || busy || refreshRequested()) return;
                const latest = response?.task, observed = taskFor(context.taskId);
                if (String(latest?.id) !== String(context.taskId) || !Number.isSafeInteger(latest?.revision)) throw new Error('Saved assignments could not be confirmed.');
                const reviewed = Number(observed?.revision) > latest.revision ? observed : latest;
                const value = context.columnId ? reviewed.values?.[context.columnId] : reviewed[context.control.dataset.fieldKind];
                context.selected = context.multiple ? [...asArray(value)] : value ? [value] : [];
                context.baseRevision = reviewed.revision;
                context.needsReview = false;
                drafts.delete(context.draftKey); draftVersions.delete(context.draftKey); draftBases.set(context.draftKey, reviewed.revision);
                tasks.set(context.taskId, { ...observed, ...reviewed }); invalidateHierarchy();
                renderPeopleOptions(peoplePopover.querySelector('[data-people-search]').value);
                peoplePopover.querySelector('[data-people-result]').textContent = 'Saved assignments loaded. Review the selection before changing it.';
                renderVirtualRows();
            } catch (error) { if (peopleContext === context && scopeIsCurrent(context.scope)) peoplePopover.querySelector('[data-people-result]').textContent = error.message || 'Reload failed. Selection retained.'; }
            finally { context.reloading = false; }
        }

        function commitPeople(uid) {
            if (!peopleContext) return;
            const context = peopleContext, control = context.control;
            if (!control) return;
            if (presentationV2 && (!scopeIsCurrent(context.scope) || !canWrite() || busy || control.disabled)) { closePeoplePicker(); return; }
            if (presentationV2) {
                if (context.reloading) return;
                if (context.needsReview || Number(taskFor(context.taskId)?.revision || 0) !== context.baseRevision) {
                    context.needsReview = true;
                    peoplePopover.querySelector('[data-people-result]').textContent = 'Task changed. Reload saved assignments and review before choosing again.';
                    return;
                }
                // The selected value and its revision are one snapshot, including between successive clicks.
                if (!draftBases.has(context.draftKey)) draftBases.set(context.draftKey, context.baseRevision);
            }
            if (presentationV2 && control.dataset.fieldKind === 'assigneeUids' && uid === effectiveField(context.taskId, 'ownerUid')) return;
            if (peopleContext.multiple) {
                const next = new Set(peopleContext.selected);
                if (next.has(uid)) next.delete(uid); else next.add(uid);
                peopleContext.selected = Array.from(next).filter(Boolean);
                Array.from(control.options).forEach((option) => { option.selected = peopleContext.selected.includes(option.value); });
                renderPeopleOptions(peoplePopover?.querySelector('[data-people-search]')?.value);
                if (presentationV2) {
                    const names = peopleContext.selected.map(memberName).join(', ');
                    const collaborators = control.dataset.fieldKind === 'assigneeUids';
                    peopleContext.trigger.innerHTML = collaborators ? peopleStack(peopleContext.selected) || '<span class="crm-people-trigger-name">Add collaborators</span>' : escape(names || 'Add people');
                    peopleContext.trigger.setAttribute('aria-label', `${collaborators ? 'Collaborators' : 'People'}: ${names || 'Unassigned'}`);
                }
            } else {
                peopleContext.selected = uid ? [uid] : [];
                control.value = uid;
                closePeoplePicker();
            }
            if (presentationV2 && !context.multiple) { if (context.trigger.closest('dialog[open]')) context.trigger.focus(); else focusRowControl(context.taskId, `[data-people-kind="${context.trigger.dataset.peopleKind}"]`); }
            if (presentationV2) {
                context.saving = (context.saving || 0) + 1;
                const selected = [...context.selected];
                saveTaskField(context.taskId, control.dataset.fieldKind, { value: selected[0] || '', dataset: { ...control.dataset }, multiple: context.multiple, selectedOptions: selected.map(value => ({ value })) }).then(lineage => {
                    context.saving--;
                    if (lineage?.bases.includes(context.baseRevision)) context.baseRevision = lineage.revision;
                    else if (!lineage) context.needsReview = true;
                    if (peopleContext === context && context.needsReview) peoplePopover.querySelector('[data-people-result]').textContent = 'Assignments were not confirmed. Reload saved assignments and review before choosing again.';
                });
            } else control.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function openPeoplePicker(trigger) {
            if (presentationV2) { closeRowEditor(false); if (!canWrite() || busy) return; }
            closePeoplePicker();
            const cell = trigger.closest('[data-column-key], [role="cell"]');
            const control = cell?.querySelector('.crm-board-field');
            if (!control || control.disabled) return;
            const multiple = trigger.dataset.peopleKind === 'assigneeUids' || (presentationV2 && control.multiple);
            peopleContext = {
                control, trigger, taskId: trigger.closest('[data-task-id]')?.dataset.taskId, scope: captureScope(), columnId: control.dataset.columnId, columnType: columns.find(c => c.id === control.dataset.columnId)?.type,
                multiple,
                selected: multiple
                    ? Array.from(control.selectedOptions || []).map((option) => option.value).filter(Boolean)
                    : (control.value ? [control.value] : [])
            };
            if (presentationV2) {
                const field = control.dataset.fieldKind === 'value' ? `value:${control.dataset.columnId}` : control.dataset.fieldKind;
                peopleContext.draftKey = draftKeyFor(peopleContext.taskId, field);
                peopleContext.baseRevision = draftBases.get(peopleContext.draftKey) ?? Number(taskFor(peopleContext.taskId)?.revision || 0);
            }
            peoplePopover = document.createElement('div');
            peoplePopover.className = 'crm-people-popover';
            peoplePopover.setAttribute('role', 'dialog');
            peoplePopover.setAttribute('aria-label', multiple ? 'Choose collaborators or people' : 'Choose accountable owner');
            peoplePopover.innerHTML = '<input type="search" class="crm-people-search" data-people-search placeholder="Search people" aria-label="Search people">'
                + `<div class="crm-people-list" role="listbox"${multiple ? ' aria-multiselectable="true"' : ''} data-people-list></div>${presentationV2 ? '<p role="status" data-people-result></p><button type="button" data-reload-people>Reload saved assignments</button><button type="button" data-people-done>Done</button>' : ''}`;
            // Parent to the panel, not <body>: the --pj-* tokens and the dark
            // override are declared on the panel, so a popover outside it has
            // no surface, no border and no ink.
            const panel = document.querySelector('[data-panel="projects"]');
            const scale = (panel && globalScope.getComputedStyle && parseFloat(globalScope.getComputedStyle(panel).zoom)) || 1;
            const validScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
            (trigger.closest('dialog[open]') || panel || document.body).appendChild(peoplePopover);
            const box = trigger.getBoundingClientRect();
            const width = 248;
            const visualWidth = width * validScale;
            peoplePopover.style.left = `${Math.max(8, Math.min(box.left, (globalScope.innerWidth || 1024) - visualWidth - 8)) / validScale}px`;
            peoplePopover.style.top = `${Math.max(8, Math.min(box.bottom + 4, (globalScope.innerHeight || 768) - (peoplePopover.offsetHeight || 300) - 8)) / validScale}px`;
            peoplePopover.style.width = `${width}px`;
            renderPeopleOptions('');
            peoplePopover.querySelector('[data-people-search]')?.focus();
            peoplePopover.addEventListener('input', (event) => {
                if (event.target.matches('[data-people-search]')) renderPeopleOptions(event.target.value);
            });
            peoplePopover.addEventListener('click', (event) => {
                if (event.target.closest('[data-reload-people]')) { reloadPeopleSelection(); return; }
                if (event.target.closest('[data-people-done]')) { closePeoplePicker(); if (trigger.closest('dialog[open]')) trigger.focus(); else { renderVirtualRows(); focusRowControl(peopleTaskId, peopleSelector); } return; }
                const option = event.target.closest('[data-people-uid]');
                if (option && !option.disabled) { event.preventDefault(); commitPeople(option.dataset.peopleUid); }
            });
            const peopleTaskId = peopleContext.taskId, peopleSelector = `[data-people-kind="${trigger.dataset.peopleKind}"]`;
            peoplePopover.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePeoplePicker(); if (presentationV2 && !trigger.closest('dialog[open]')) { renderVirtualRows(); focusRowControl(peopleTaskId, peopleSelector); } else trigger.focus(); }
                else if (presentationV2 && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
                    event.preventDefault(); const options = Array.from(peoplePopover.querySelectorAll('[data-people-uid]:not(:disabled)'));
                    const index = options.indexOf(document.activeElement), delta = event.key === 'ArrowDown' ? 1 : -1;
                    options[(index + delta + options.length) % options.length]?.focus();
                }
            });
        }

        function onBoardClick(event) {
            const row = event.target.closest('[data-row-id]');
            if (row?.dataset?.rowKind === 'summary' && !event.target.closest('[data-action="quick-task"]')) return;
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
            if (presentationV2 && row && handleRowEditorAction(action, row, event)) return;
            if (action === 'toggle-task' && row) { toggleTask(row.dataset.taskId); return; }
            if (action === 'quick-task') { openQuickComposer(null, event.target.closest('[data-section-id]')?.dataset.sectionId); return; }
            if (action === 'add-subtask' && row) { event.stopPropagation(); openQuickComposer(row.dataset.taskId); return; }
            if (action === 'pick-date') { event.stopPropagation(); globalScope.CrmProjectsDatePicker?.open(event.target.closest('.crm-board-date-control')?.querySelector('input')); return; }
            if (action === 'pick-people') { event.stopPropagation(); openPeoplePicker(event.target.closest('[data-people-kind]')); return; }
            if (action === 'pick-status') { event.stopPropagation(); openStatusPicker(event.target.closest('.crm-board-status-pill')); return; }
            if (action === 'drag-handle') return;
            if (presentationV2 && !['open-detail', 'open-subtasks'].includes(action)) return;
            if (!['open-detail', 'open-subtasks'].includes(action) && event.target.closest('input, select, textarea, button, a')) return;
            if (row?.dataset?.rowKind === 'task') { selectedTaskId = row.dataset.taskId; focusedRowId = row.dataset.rowId; renderDetail({ open: true }); renderVirtualRows(); }
        }

        function onBoardChange(event) {
            const control = event.target.closest('.crm-board-field');
            if (control && (control.dataset.fieldKind === 'status' || (control.dataset.fieldKind === 'value' && control.classList.contains('crm-board-status-select')))) {
                syncStatusElement(control, control.value);
            }
            const row = control?.closest('[data-task-id]');
            if (control && row && !(presentationV2 && control.dataset.fieldKind === 'title')) saveTaskField(row.dataset.taskId, control.dataset.fieldKind, control);
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
            dirtyField(captureScope(), taskId, kind === 'value' ? `value:${control.dataset.columnId}` : kind);
        }

        function onBoardKeydown(event) {
            if (presentationV2 && handleRowEditorKey(event)) return;
            const row = event.target.closest('[data-row-id]');
            if (!row) return;
            if (event.key === 'Enter' && event.target === row) { event.preventDefault(); selectedTaskId = row.dataset.taskId || ''; renderDetail({ open: true }); return; }
            if (row.dataset.rowKind !== 'task' || event.target !== row) return;
            selectedTaskId = row.dataset.taskId;
            if (event.key === 'Tab') return;
            if (event.altKey && canWrite() && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); selectedSiblingMove(0, event.key === 'ArrowRight' ? 1 : -1); }
            else if (event.key === 'ArrowRight') { event.preventDefault(); if (!expanded.has(selectedTaskId)) toggleTask(selectedTaskId); else row.querySelector('.crm-board-expander')?.focus(); }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); if (expanded.has(selectedTaskId)) toggleTask(selectedTaskId); else { const parent = taskFor(selectedTaskId)?.parentTaskId; if (parent) { selectedTaskId = parent; renderBoard(); } } }
            else if (event.key === 'ArrowDown') { event.preventDefault(); selectedSiblingMove(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); selectedSiblingMove(-1); }
            else if (event.key.toLowerCase() === 'n' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); openQuickComposer(selectedTaskId); }
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
            if (presentationV2 && !detailSurface && globalScope.CrmProjectsDetailSurfaceV2 && elements.projectsBoardDetail) {
                detailSurface = globalScope.CrmProjectsDetailSurfaceV2.createController({ panel: document.querySelector('[data-panel="projects"]'), dialog: elements.projectsBoardDetail,
                    onClose: () => { selectedTaskId = ''; renderDetail(); }, fallbackFocus: restoreDetailFocus,
                    captureFocusScope: captureScope, canRestoreFocus: canRestoreDetailFocus,
                    onTabActivated: name => {
                        const task = taskFor(selectedTaskId);
                        if (task && scopeIsCurrent(captureScope()) && !authorityPending) globalScope.CrmProjectsDiscussion?.setSelection({ deferLoad: name !== 'updates', projectId: currentProjectId(), taskId: task.id, taskRevision: Number(task.revision || 0), role: role(), lifecycle: task.effectiveLifecycle || task.lifecycle || 'active' });
                    },
                    onClear: () => { globalScope.CrmProjectsDiscussion?.setSelection(null); document.getElementById('projects-task-planning')?.replaceChildren(); } });
                detailSurface.init();
                const body = elements.projectsBoardDetailBody;
                const click = event => { const row = event.target.closest('[data-task-id]'), trigger = event.target.closest('[data-action]'); if (!row || !trigger) return; if (trigger.dataset.action === 'pick-status') openStatusPicker(trigger); else if (trigger.dataset.action === 'pick-people') openPeoplePicker(trigger); else if (trigger.dataset.action === 'edit-dates') openDateRange(row.dataset.taskId, trigger); };
                const change = event => { if (elements.projectsBoardDetail.dataset.detailTransition) return; if (event.target.dataset.fieldKind === 'title') saveTaskField(event.target.closest('[data-task-id]').dataset.taskId, 'title', event.target); else onBoardChange(event); };
                for (const [type, handler] of [['click', click], ['input', onBoardInput], ['change', change]]) { body?.addEventListener(type, handler); detailRemovers.push(() => body?.removeEventListener(type, handler)); }
            }
            if (presentationV2 && !tableLayout) {
                tableLayout = globalScope.CrmProjectsTableLayoutV2.createController({ elements, getCurrentUser: deps.getCurrentUser, storage: deps.presentationStorage, onChange: () => { renderHeader(); renderVirtualRows(); } });
                tableLayout.init();
                mobileMore = document.createElement('button'); mobileMore.type = 'button'; mobileMore.textContent = 'Show more loaded tasks'; mobileMore.hidden = true;
                mobileMore.dataset.mobileMore = ''; elements.projectsBoardScroll.after(mobileMore);
                mobileMore.addEventListener('click', () => { const next = logicalRows[mobileLimit]; mobileLimit += 50; renderVirtualRows({ focusRowId: next?.id || '' }); if (next) focusNavigationRow(next.id); });
                mobilePrevious = document.createElement('button'); mobilePrevious.type = 'button'; mobilePrevious.textContent = 'Show earlier loaded tasks'; mobilePrevious.hidden = true; mobilePrevious.dataset.mobilePrevious = '';
                mobileMore.before(mobilePrevious);
                mobilePrevious.addEventListener('click', () => { mobileLimit = Math.max(50, mobileLimit - MOBILE_WINDOW); const row = logicalRows[Math.max(0, mobileLimit - MOBILE_WINDOW)]; renderVirtualRows({ focusRowId: row?.id || '' }); if (row) focusNavigationRow(row.id); });
                const panel = document.querySelector('[data-panel="projects"]');
                if (globalScope.ResizeObserver && panel) { layoutObserver = new globalScope.ResizeObserver(syncListWidth); layoutObserver.observe(panel); }
                syncListWidth();
            }
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
            document.getElementById('btn-projects-board-add-task')?.addEventListener('click', startTopLevelTaskCreation);
            document.getElementById('btn-projects-board-add-column')?.addEventListener('click', () => openColumnForm());
            document.getElementById('btn-projects-board-save-column')?.addEventListener('click', createColumn);
            document.getElementById('btn-projects-board-cancel-column')?.addEventListener('click', () => { if (!columnEditor?.pending) resetColumnForm(); });
            document.getElementById('btn-projects-board-save-settings')?.addEventListener('click', saveSettings);
            document.getElementById('btn-projects-board-close-detail')?.addEventListener('click', () => { if (globalScope.CrmProjectsDetailSurfaceV2?.hasOwner(elements.projectsBoardDetail)) return; selectedTaskId = ''; renderDetail(); });
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
            elements.projectsBoardScroll?.addEventListener('scroll', () => {
                if (!presentationV2) { closePeoplePicker(); closeStatusPicker(); return; }
                if (peoplePopover && !followRowPicker(peoplePopover, peopleContext)) closePeoplePicker();
                if (statusPopover && !followRowPicker(statusPopover, statusContext)) closeStatusPicker();
                if (rowEditor && !followRowPicker(rowEditor.node, rowEditor)) closeRowEditor(false);
            }, { passive: true });
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
                if (tab && !globalScope.CrmProjectsDetailSurfaceV2?.hasOwner(elements.projectsBoardDetail)) activateDetailTab(tab.dataset.detailTab);
            });
            elements.projectsBoardDetail?.addEventListener?.('keydown', (event) => {
                if (globalScope.CrmProjectsDetailSurfaceV2?.hasOwner(elements.projectsBoardDetail) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.matches?.('[data-detail-tab]')) return;
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
            const previousProject = project;
            const structureChanged = Number(authority.project.structureRevision || 0) !== structureRevision();
            const schemaChanged = Number(authority.project.schemaRevision || 0) !== boardRevision.schemaRevision;
            const lifecycleChanged = authority.project.lifecycle !== project.lifecycle;
            const membershipChanged = authority.project.membershipRevision !== project.membershipRevision || authority.membership.role !== role();
            if (Number(authority.project.revision || 0) >= projectRevision()) project = { ...project, ...authority.project };
            membership = { ...membership, ...authority.membership };
            if (presentationV2 && (membershipChanged || lifecycleChanged)) clearDetailPresentation();
            if (membershipChanged) { authorityRevision++; if (!canSchema()) { resetSectionForm(); resetColumnForm(); } }
            const hasChanges = Boolean(change.changes && change.changes.length > 0);
            const selfEcho = Boolean(
                hasChanges
                    ? change.changes.every(item => item.operationId && recentlyExecutedOperations.has(item.operationId))
                    : (change.operationId && recentlyExecutedOperations.has(change.operationId))
            );
            const projectionChanged = !selfEcho && asArray(change.changes).some(entry => entry.command !== 'updateTaskLinks' && asArray(entry.taskIds).some(id => !tasks.has(id)));
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
                // A fully acknowledged local echo contains no new presentation
                // state. Do not rebuild rows, detail or context subscribers twice.
                if (selfEcho && !membershipChanged && !change.authorityChanged && !change.refresh
                    && JSON.stringify(previousProject) === JSON.stringify(project)
                    && !asArray(change.hydration?.unavailableTaskIds).length
                    && asArray(change.hydration?.tasks).every(task => {
                        const old = taskFor(task.id);
                        return old && JSON.stringify({ ...old, ...task }) === JSON.stringify(old);
                    })) return true;
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
                invalidateHierarchy();
                if (hasChanges || membershipChanged || change.authorityChanged) { renderBoard({ projectionChanged }); restoreView(view); }
            }
            return true;
        }
        function reconcileUnavailableTask(taskId) {
            const removed = new Set([String(taskId)]);
            // A missing/archived parent also invalidates its loaded descendants.
            let changed = true;
            while (changed) {
                changed = false;
                for (const [id, entry] of tasks) {
                    if (!removed.has(id) && (removed.has(entry.parentTaskId) || asArray(entry.ancestorIds).some(id => removed.has(id)) || asArray(entry.pathIds).some(id => removed.has(id)))) {
                        removed.add(id); changed = true;
                    }
                }
            }
            const active = document.activeElement;
            const activeTask = active?.closest?.('[data-task-id]')?.dataset.taskId;
            const detailRemoved = removed.has(selectedTaskId);
            const losesFocus = removed.has(activeTask) || detailRemoved && elements.projectsBoardDetail?.contains(active)
                || removed.has(rowEditor?.taskId) && rowEditor.node.contains(active)
                || removed.has(statusContext?.taskId) && statusPopover?.contains(active)
                || removed.has(peopleContext?.taskId) && peoplePopover?.contains(active);
            const index = logicalRows.findIndex(row => row.id === (active?.closest?.('[data-row-id]')?.dataset.rowId || `task:${taskId}`));
            const available = row => row.task && !removed.has(String(row.task.id));
            const fallback = logicalRows.slice(index + 1).find(available) || logicalRows.slice(0, Math.max(0, index)).reverse().find(available);
            removed.forEach(id => {
                tasks.delete(id); projectionTaskIds.delete(id); expanded.delete(id);
                loadedBranches.delete(id); branchCursors.delete(id); branchHasMore.delete(id);
            });
            if (detailRemoved) selectedTaskId = '';
            if (removed.has(focusedRowId.replace(/^task:/, ''))) focusedRowId = fallback?.id || '';
            invalidateHierarchy();
            setSelectedTaskIds(selectedTaskIds.filter(id => !removed.has(id)));
            renderVirtualRows({ focusRowId: losesFocus ? fallback?.id || '' : '' });
            if (detailRemoved) renderDetail();
            if (elements.projectsBoardCount) elements.projectsBoardCount.textContent = `${tasks.size} loaded · ${sections.length} section${sections.length === 1 ? '' : 's'}`;
            setStatus('Task is unavailable. Select another task.', 'warning');
            publishContext({ unavailableTaskIds: [...removed] });
            if (losesFocus) {
                const target = fallback && Array.from(elements.projectsBoardRows?.children || []).find(node => node.dataset.rowId === fallback.id);
                (target || elements.projectsBoardRefresh)?.focus?.({ preventScroll: true });
            }
        }
        // Read projections may supply identity/revision, never mutation authority or
        // branch completeness. Resolve against the active project's canonical endpoint.
        async function resolveTask(taskId, { projectId = currentProjectId(), actorUid = controllerActorUid, revision, isCurrent = () => true } = {}) {
            const scope = captureScope(), authority = authorityRevision;
            const valid = () => scopeIsCurrent(scope) && isCurrent() && String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid && actorUid === controllerActorUid && projectId === currentProjectId()
                && !authorityPending && !refreshRequested() && authority === authorityRevision && hasProject();
            if (!taskId || !valid()) throw new Error('Task context is no longer available.');
            let result;
            try { result = await apiFetchJson(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`); }
            catch (error) {
                if (valid() && [401, 403].includes(Number(error.status))) invalidateAccess(projectId);
                if (valid() && Number(error.status) === 404) {
                    reconcileUnavailableTask(taskId);
                }
                throw error;
            }
            if (!valid()) throw new Error('Task context changed while loading.');
            const next = result?.task, old = taskFor(taskId);
            if (!next || String(next.id) !== String(taskId) || (next.projectId && next.projectId !== projectId)
                || !Number.isSafeInteger(next.revision)) throw new Error('Task is no longer available.');
            if ((next.effectiveLifecycle || next.lifecycle || 'active') !== 'active') {
                reconcileUnavailableTask(taskId);
                throw new Error('Task is no longer available.');
            }
            if (revision !== undefined && (next.revision !== revision || (old && old.revision > revision))) throw new Error('Task changed. Refresh this view before editing.');
            if (pending.has(pendingKey(taskId))) throw new Error('A task change is still saving.');
            const canonical = old && Number(old.revision) > next.revision ? old : { ...old, ...next };
            if (!old) projectionTaskIds.add(String(taskId));
            tasks.set(String(taskId), canonical); invalidateHierarchy();
            // Do not touch loadedBranches, cursors, selection or draft bases here.
            return canonical;
        }
        async function setTaskField(command = {}) {
            const { taskId, field, value, revision } = command;
            if (!['status', 'title', 'ownerUid', 'assigneeUids'].includes(field) || !Number.isSafeInteger(revision) || !canWrite()) throw new Error('This task command is unavailable.');
            if (field === 'status' && !Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)) throw new Error('Unknown task status.');
            const key = draftKeyFor(taskId, field);
            if (drafts.has(key)) throw new Error('Review the existing field draft before editing from another view.');
            const resolved = await resolveTask(taskId, command);
            if (!canWrite() || drafts.has(key)) throw new Error('Task authority or draft changed.');
            if (resolved[field] === value) return { task: resolved, unchanged: true };
            const lineage = await saveTaskField(taskId, field, { value, dataset: {}, multiple: Array.isArray(value), selectedOptions: Array.isArray(value) ? value.map(value => ({ value })) : [] });
            if (!lineage || command.isCurrent?.() === false) throw new Error('The change was not confirmed. Review the retained draft and save feedback.');
            return { task: taskFor(taskId), lineage };
        }
        return { init, refresh, setProjects, loadProject, invalidateAccess, setSelectedTaskIds, getSnapshot: contextSnapshot,
            resolveTask, setTaskField, setTableVisibility,
            subscribeContext(listener) { contextListeners.add(listener); return () => contextListeners.delete(listener); },
            closeTask() { if (detailSurface) detailSurface.requestClose(); else { selectedTaskId = ''; renderDetail(); } },
            activateDetailTab(name) { if (detailSurface) detailSurface.activateTab(name); else activateDetailTab(name); },
            setColumnPreferences: value => tableLayout?.update(value),
            getColumnPreferences: () => tableLayout?.getPreferences(),
            disposePresentation() {
                clearSuspendedTableEdit();
                clearQuickCreation();
                if (!presentationV2) return;
                clearRemoteConflictReview(); clearDetailPresentation(); detailSurface?.dispose(); detailSurface = null; detailRemovers.splice(0).forEach(remove => remove());
                closePeoplePicker(); closeStatusPicker(); closeRowEditor(false); renameSession = null; feedbackStore?.dispose();
                layoutObserver?.disconnect(); mobileMore?.remove(); mobilePrevious?.remove(); mobileList = false; elements.projectsBoardTable?.removeAttribute('data-presentation'); elements.projectsBoardTable?.setAttribute('role', 'table'); elements.projectsBoardRows?.setAttribute('role', 'rowgroup'); elements.projectsBoardHeader.hidden = false;
                tableLayout?.dispose(); tableLayout = null; presentationV2 = false; renderedHeaderSignature = '';
                elements.projectsBoardTable?.removeAttribute('aria-colcount'); elements.projectsBoardHeader?.removeAttribute('aria-rowindex');
                if (String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid) { renderHeader(); renderVirtualRows(); }
            },
            getFieldSaveScope: () => fieldSaveScope(),
            attachRemoteObserver(observer) { remoteObserver = observer; }, applyRemote,
            setDensity: (mode, fontScale) => {
                const scroll = elements.projectsBoardScroll;
                const anchor = (scroll?.scrollTop || 0) / ROW_HEIGHT;
                const scale = Number.isFinite(fontScale) && fontScale >= 0.7 && fontScale <= 1.5 ? Math.max(1, fontScale) : 1;
                ROW_HEIGHT = Math.ceil((mode === 'compact' ? 36 : 44) * scale);
                elements.projectsBoardTableWrap?.classList.toggle('is-compact', mode === 'compact');
                if (fontScale !== undefined) elements.projectsBoardTableWrap?.style?.setProperty('--pj-row-h', `${ROW_HEIGHT}px`);
                renderBoard();
                // Update the spacer first: otherwise the browser clamps a larger
                // scaled scroll offset to the previous layout's maximum.
                if (scroll && fontScale !== undefined) {
                    scroll.scrollTop = anchor * ROW_HEIGHT;
                    renderVirtualRows({ viewportOnly: true });
                }
            },
            saveTaskField: (taskId, kind, control) => saveTaskField(taskId, kind, control),
            saveSection: (sectionId, control) => saveSection(sectionId, control),
            createSection: () => createSection(),
            createTask: (parentTaskId, explicitSectionId, options) => createTask(parentTaskId, explicitSectionId, options),
            moveSection: (sectionId, index) => moveSection(sectionId, index),
            moveTask: (taskId, destination) => moveTask(taskId, destination),
            setFilters: (filters, options = {}) => {
                sharedFilters = { ...filters };
                filterGeneration++;
                if (options.refresh === false) return Promise.resolve();
                if (currentProjectId()) {
                    authorityPending = true;
                    setBusy(true);
                }
                return refresh();
            },
            selectTask: (task) => {
                if (!task?.id || !hasProject() || String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid || (task.projectId && String(task.projectId) !== currentProjectId())) return;
                const id = String(task.id), old = tasks.get(id);
                if (old && Number(old.revision || 0) > Number(task.revision ?? old.revision)) task = old;
                const merged = { ...old, ...task };
                tasks.set(id, merged);
                invalidateHierarchy();
                asArray(merged.pathIds).filter(pid => String(pid) !== id).forEach(pid => expanded.add(String(pid)));
                selectedTaskId = id;
                renderDetail({ open: true });
                renderVirtualRows();
            },
            updateTask: (task) => {
                if (!task?.id || !hasProject()) return;
                if (task.projectId && String(task.projectId) !== currentProjectId()) return;
                if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) return;
                const id = String(task.id);
                if (!tasks.has(id)) return;
                const old = tasks.get(id);
                if (Number(task.revision || 0) < Number(old.revision || 0)) return;
                const merged = { ...old, ...task };
                tasks.set(id, merged);
                tasksVersion++;
                const isStructural = (task.parentTaskId !== undefined && task.parentTaskId !== old.parentTaskId) ||
                    (task.sectionId !== undefined && task.sectionId !== old.sectionId) ||
                    (task.rank !== undefined && task.rank !== old.rank) ||
                    (task.lifecycle !== undefined && task.lifecycle !== old.lifecycle) ||
                    (currentGroupBy === 'status' && task.status !== undefined && task.status !== old.status) ||
                    (currentGroupBy === 'ownerUid' && task.ownerUid !== undefined && task.ownerUid !== old.ownerUid) ||
                    (currentGroupBy === 'priority' && (task.priority !== old.priority || task.values?.priority !== old.values?.priority));
                if (isStructural && typeof invalidateHierarchy === 'function') {
                    invalidateHierarchy();
                }
                renderVirtualRows();
                if (selectedTaskId === id) renderDetail();
                publishContext();
            },
            getState: contextSnapshot };
    }

    globalScope.CrmProjectsBoard = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
