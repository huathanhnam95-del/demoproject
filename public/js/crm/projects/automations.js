(function (globalScope) {
  'use strict';
  const E = globalScope.CrmAutomationDefinitionEditor, R = globalScope.CrmAutomationsRenderer, clone = E.clone;
  const op = () => `designer-${globalScope.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const resources = new Set(['AUTOMATION_NOT_FOUND', 'AUTOMATION_VERSION_NOT_FOUND', 'RUN_NOT_FOUND', 'TASK_NOT_FOUND', 'TASK_UNAVAILABLE', 'BROKEN_REFERENCE', 'INVALID_TASK_REFERENCE']);
  function createController(deps = {}) {
    const root = deps.root, button = deps.button, api = deps.apiFetchJson;
    let actorUid = '', projectId = '', epoch = 0, generation = 0, context = {}, contextSignature = '', blockedAuthority = null;
    let opened = false, mode = 'manage', representation = 'recipe', picker = '', pickerQuery = '', pickerRestore = '', focusPickerSearch = false, status = '', rule = null, version = null, draft = null, baseDefinition = '', dirty = false, preview = null, diagnostics = [];
    let items = [], cursor = null, loading = false, filters = { query: '', folderMode: 'all', folder: '', enabled: '' };
    const seq = { list: 0, detail: 0, preview: 0, search: 0, history: 0, run: 0 };
    let pending = null, inFlight = false, conflict = false, sample = null, search = null, history = { kind: '', items: [], cursor: null }, taskLabels = {};
    const uid = () => String(deps.getCurrentUser?.()?.uid || '');
    const scope = () => ({ actorUid, projectId, epoch });
    const current = s => !!s?.actorUid && s.actorUid === actorUid && s.actorUid === uid() && s.projectId === projectId && s.epoch === epoch;
    const owner = () => !!actorUid && actorUid === uid() && !!projectId && context.actorUid === actorUid && context.project?.id === projectId && (context.project.lifecycle || 'active') === 'active' && context.membership?.role === 'Owner' && blockedAuthority === null;
    const ready = () => owner() && !!context.filterOptionsReady;
    const base = () => `/api/projects/${encodeURIComponent(projectId)}`;
    const state = () => clone({ actorUid, projectId, epoch, generation, opened, mode, representation, picker, pickerQuery, status, rule, version, draft, dirty, preview, diagnostics, items, cursor, loading, filters, pending, inFlight, conflict, sample, search, history, ready: ready(), owner: owner() });
    function reset(message = '') {
      epoch++; generation++; Object.keys(seq).forEach(key => seq[key]++);
      opened = false; mode = 'manage'; representation = 'recipe'; picker = ''; pickerQuery = ''; pickerRestore = ''; focusPickerSearch = false; rule = null; version = null; draft = null; baseDefinition = ''; dirty = false; preview = null; diagnostics = []; items = []; cursor = null; loading = false;
      pending = null; inFlight = false; conflict = false; sample = null; search = null; history = { kind: '', items: [], cursor: null }; taskLabels = {}; status = message; render();
    }
    function setAccount(value) { if (String(value || '') === actorUid) return; actorUid = String(value || ''); projectId = ''; context = {}; contextSignature = ''; blockedAuthority = null; reset(); }
    function setSelection(value) { const id = String(value || ''); if (id === projectId) return; projectId = id; context = {}; contextSignature = ''; blockedAuthority = null; reset(); }
    function setContext(snapshot = {}) {
      if (snapshot.actorUid !== actorUid || snapshot.project?.id !== projectId) return;
      const signature = JSON.stringify([snapshot.project?.schemaRevision, snapshot.project?.structureRevision, snapshot.project?.statusLabels, snapshot.columns, snapshot.sections, snapshot.members, snapshot.membership?.role]);
      context = { actorUid: snapshot.actorUid, project: clone(snapshot.project), membership: clone(snapshot.membership), members: clone(snapshot.members || []), sections: clone(snapshot.sections || []), columns: clone(snapshot.columns || []), filterOptionsReady: snapshot.filterOptionsReady, authorityRevision: snapshot.authorityRevision || 0 };
      if (blockedAuthority !== null && context.authorityRevision > blockedAuthority && context.filterOptionsReady) blockedAuthority = null;
      if (context.membership && context.membership.role !== 'Owner' || (context.project.lifecycle || 'active') !== 'active') { reset('Automation editing requires current Owner access.'); contextSignature = signature; return; }
      if (signature !== contextSignature) { if (preview || status === 'Preparing preview…') status = 'Project context changed. Preview again before activation.'; preview = null; seq.preview++; contextSignature = signature; }
      if (snapshot.filterOptionsReady) for (const [id, task] of snapshot.tasks || []) taskLabels[id] = task.title;
      render();
    }
    function ownerDenied() {
      blockedAuthority = context.authorityRevision || 0; reset('Owner access changed. Refreshing current project access…');
      const s = scope(); Promise.resolve().then(() => deps.refreshBoard?.()).catch(() => { if (current(s)) { status = 'Owner access could not be refreshed. Refresh the board to try again.'; render(); } });
    }
    const errorCode = error => error?.payload?.error || error?.payload?.code || error?.code || '';
    function fail(error, s, taskReference = false) {
      if (!current(s)) return;
      if (error?.status === 401) { reset('Account access changed.'); deps.onAccountDenied?.(); return; }
      if (error?.status === 403 && !taskReference) { ownerDenied(); return; }
      if (error?.status === 404 && !resources.has(errorCode(error)) && !taskReference) { reset('Project access is unavailable.'); deps.onContentDenied?.(s.projectId); return; }
      if (error?.status === 409 && ['STALE_REVISION', 'STALE_PREVIEW', 'OPERATION_CONFLICT'].includes(errorCode(error))) { conflict = true; preview = null; seq.preview++; }
      status = error?.message || 'Could not complete this request. Retry.'; render();
    }
    function changed(next) { draft = clone(next); generation++; dirty = !rule || JSON.stringify(draft.definition) !== baseDefinition || draft.actorUid !== version?.actorUid; preview = null; seq.preview++; status = 'Unsaved changes.'; render(); }
    function clearPanels() { seq.search++; seq.history++; seq.run++; search = null; history = { kind: '', items: [], cursor: null }; }
    function newDraft() {
      if (!ready()) return;
      if (pending) { status = 'Resolve the interrupted change before starting another draft.'; render(); return; }
      clearPanels(); seq.detail++; rule = null; version = null; baseDefinition = ''; sample = null; diagnostics = []; conflict = false;
      draft = { title: 'New automation', folder: '', actorUid, definition: E.createBlank(context) }; generation++; dirty = true; preview = null; picker = ''; pickerQuery = ''; representation = 'recipe'; mode = 'edit'; opened = true; render();
    }
    function showCreate() {
      if (!ready()) return;
      if (pending) { status = 'Resolve the interrupted change before starting another draft.'; render(); return; }
      clearPanels(); seq.detail++; rule = null; version = null; baseDefinition = ''; sample = null; diagnostics = []; conflict = false; draft = null; dirty = false; preview = null; picker = ''; pickerQuery = ''; representation = 'recipe'; mode = 'create'; opened = true; render();
    }
    function openSimplePicker(kind) { if (['trigger', 'action'].includes(kind)) { picker = kind; pickerQuery = ''; pickerRestore = ''; focusPickerSearch = true; render(); } }
    function closeSimplePicker() { pickerRestore = picker; picker = ''; pickerQuery = ''; render(); }
    function chooseSimpleTrigger(type) {
      if (!draft || !E.triggers.includes(type)) return;
      const trigger = type === 'due_date' ? { type, time: '09:00', offsetDays: 0 } : { type };
      pickerRestore = 'trigger'; changed({ ...draft, definition: { ...draft.definition, trigger } }); picker = ''; pickerQuery = ''; render();
    }
    function chooseSimpleAction(type) {
      if (!draft || !E.types.includes(type)) return;
      const existing = draft.definition.steps?.[0], node = E.newNode(type, context);
      if (existing?.nodeId) node.nodeId = existing.nodeId;
      pickerRestore = 'action'; changed({ ...draft, definition: { ...draft.definition, steps: existing ? [node, ...draft.definition.steps.slice(1)] : [node] } }); picker = ''; pickerQuery = ''; render();
    }
    async function show() { if (!ready()) return; opened = true; render(); if (mode === 'manage') await loadList(); }
    async function loadList(append = false) {
      if (!ready() || append && (!cursor || loading)) return;
      const s = scope(), serial = ++seq.list, query = new URLSearchParams({ pageSize: '25' });
      if (filters.query.trim()) query.set('query', filters.query.trim());
      if (filters.folderMode !== 'all') query.set('folder', filters.folderMode === 'unfiled' ? '' : filters.folder.trim());
      if (filters.enabled) query.set('enabled', filters.enabled);
      if (append) query.set('cursor', cursor); else { items = []; cursor = null; }
      loading = true; status = 'Loading automations…'; render();
      try { const result = await api(`${base()}/automations?${query}`); if (!current(s) || serial !== seq.list) return; items = append ? items.concat(result.items || []) : result.items || []; cursor = result.hasMore ? result.nextCursor : null; status = items.length ? `${items.length} automations loaded.` : cursor ? 'No matches in this page. Continue searching.' : 'No automations match these filters.'; }
      catch (error) { if (serial === seq.list) fail(error, s); }
      finally { if (current(s) && serial === seq.list) { loading = false; render(); } }
    }
    function setFilters(value) { filters = { ...filters, ...clone(value) }; return loadList(); }
    async function openRule(id, { preserveDraft = false, versionId = '' } = {}) {
      if (!ready() || pending) return;
      const s = scope(), serial = ++seq.detail, draftAtStart = generation;
      clearPanels(); preview = null; seq.preview++; status = 'Loading automation…'; render();
      try {
        const result = await api(`${base()}/automations/${encodeURIComponent(id)}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`);
        if (!current(s) || serial !== seq.detail || draftAtStart !== generation) return;
        rule = clone(result.rule); version = clone(result.version); diagnostics = clone(result.diagnostics || []); baseDefinition = JSON.stringify(version.definition);
        if (!preserveDraft) { draft = { title: rule.title, folder: rule.folder || '', actorUid: version.actorUid, definition: clone(version.definition) }; dirty = false; generation++; }
        representation = version.definition?.condition || (version.definition?.steps || []).length !== 1 || version.definition?.steps?.[0]?.type === 'if' ? 'blocks' : 'recipe'; picker = ''; pickerQuery = '';
        conflict = false; mode = 'edit'; opened = true; status = preserveDraft ? 'Current revision loaded. Review your retained draft, save, then preview.' : diagnostics.length ? 'Some references need repair. Replace unavailable selections below.' : 'Automation loaded.';
        render(); resolveTaskLabels(version.definition);
      } catch (error) { if (serial === seq.detail) fail(error, s); }
    }
    async function resolveTaskLabels(definition) {
      const s = scope(), serial = seq.detail, ids = new Set(); E.walk(definition, ({ node }) => { for (const value of [node.payload?.target, node.payload?.parent]) if (value?.taskId) ids.add(value.taskId); });
      for (const id of ids) {
        if (!current(s) || serial !== seq.detail) return;
        try { const result = await api(`${base()}/tasks/${encodeURIComponent(id)}`); if (!current(s) || serial !== seq.detail) return; if (result.task) taskLabels[id] = result.task.title; }
        catch (error) { if (current(s) && serial === seq.detail) { delete taskLabels[id]; if (error.status === 401) { fail(error, s, true); return; } } }
      }
      if (current(s) && serial === seq.detail) render();
    }
    function updateDraft(update) { if (ready() && draft) changed(typeof update === 'function' ? update(clone(draft)) : { ...draft, ...clone(update) }); }
    function editDefinition(fn) { if (!ready() || !draft) return; try { changed({ ...draft, definition: fn(clone(draft.definition)) }); } catch (error) { status = error.message; render(); } }
    function setRepresentation(value) { if (['recipe', 'blocks'].includes(value)) { representation = value; render(); } }
    function validation() { return draft ? [...(!draft.title.trim() ? ['Give the automation a title.'] : []), ...E.validate(draft.definition, context)] : ['Create or open an automation first.']; }
    async function dispatch(request) {
      if (!ready() || inFlight || !current(request.scope)) return;
      pending = request; inFlight = true; status = 'Saving change…'; render();
      try {
        const result = await api(request.path, { method: request.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) });
        if (!current(request.scope)) return;
        pending = null; conflict = false;
        if (request.kind === 'duplicate') status = 'A disabled copy was created. Open Manage to edit it.';
        else {
          rule = clone(result.rule || rule); if (result.version) version = clone(result.version);
          if (['create', 'save'].includes(request.kind)) {
            baseDefinition = JSON.stringify(version.definition);
            if (generation === request.generation) { draft = { ...draft, ...(request.kind === 'create' ? { title: rule.title, folder: rule.folder || '' } : {}), actorUid: version.actorUid, definition: clone(version.definition) }; dirty = false; } else dirty = true;
            status = dirty ? 'Earlier change saved. Your newer draft is retained; review and save it.' : rule.enabled && rule.candidateVersion ? 'Candidate saved. The active version continues until this candidate is activated.' : 'Version saved. Preview before activation.';
          } else status = request.kind === 'activate' ? 'Automation activated.' : request.kind === 'disable' ? 'Automation disabled. Pending effects will stop.' : 'Metadata saved.';
        }
        preview = null; seq.preview++;
      } catch (error) {
        if (!current(request.scope)) return;
        if (!error.status || error.status >= 500) status = 'Acknowledgement was interrupted. Retry the original change before another mutation. Your newer draft is retained.';
        else { pending = null; fail(error, request.scope); }
      } finally { if (current(request.scope)) { inFlight = false; render(); } }
    }
    async function mutate(kind) {
      if (!ready() || inFlight) return;
      if (pending) { status = 'Retry the original interrupted change first. Your newer draft is retained.'; render(); return; }
      if (conflict) { status = 'Refresh the current revision and review your retained draft first.'; render(); return; }
      let body, path = `${base()}/automations`, method = 'POST';
      if (kind === 'create' || kind === 'save') {
        const errors = validation(); if (errors.length) { status = errors.join(' '); render(); return; } kind = rule ? 'save' : 'create';
        body = rule ? { expectedRevision: rule.revision, definition: clone(draft.definition), actorUid: draft.actorUid } : { title: draft.title.trim(), folder: draft.folder.trim(), definition: clone(draft.definition) };
        if (rule) path += `/${encodeURIComponent(rule.ruleId)}/versions`;
      } else {
        if (!rule) return; path += `/${encodeURIComponent(rule.ruleId)}`; body = { expectedRevision: rule.revision };
        if (kind === 'activate') { if (!preview || dirty || preview.generation !== generation || preview.versionId !== version?.versionId || Date.parse(preview.expiresAt) <= Date.now()) { status = 'Save and generate a fresh preview before activation.'; render(); return; } path += '/activate'; body = { ...body, versionId: version.versionId, previewToken: preview.previewToken }; }
        else if (kind === 'duplicate') path += '/duplicate';
        else { method = 'PATCH'; body = { ...body, ...(kind === 'disable' ? { enabled: false } : { title: draft.title.trim(), folder: draft.folder.trim() }) }; }
      }
      body.operationId = op(); return dispatch({ scope: scope(), kind, path, method, body: clone(body), generation });
    }
    function retryMutation() { if (pending && !inFlight) return dispatch(pending); }
    async function generatePreview() {
      if (search?.selecting) { status = 'Confirming the selected task. Wait before previewing.'; render(); return; }
      if (!ready() || pending || inFlight || !rule || !version || !sample || dirty || JSON.stringify(draft.definition) !== baseDefinition) { status = 'Save the definition and choose a sample task before previewing.'; render(); return; }
      const s = scope(), draftAtStart = generation, serial = ++seq.preview, versionId = version.versionId; preview = null; status = 'Preparing preview…'; render();
      try {
        const result = await api(`${base()}/automations/${encodeURIComponent(rule.ruleId)}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId, sampleTaskId: sample.id }) });
        if (!current(s) || draftAtStart !== generation || serial !== seq.preview || versionId !== version?.versionId) return;
        preview = { ...clone(result), generation }; status = 'Preview ready. Review the effects, then activate explicitly.'; render();
      } catch (error) { if (serial === seq.preview && draftAtStart === generation) fail(error, s, errorCode(error) === 'BROKEN_REFERENCE'); }
    }
    function beginSearch(destination = { sample: true }) { if (!ready()) return; search = { destination: clone(destination), query: '', items: [], cursor: null, loading: false }; seq.search++; render(); }
    async function searchTasks(query = search?.query || '', append = false) {
      if (!ready() || !search || append && !search.cursor) return;
      const s = scope(), serial = ++seq.search; search.selecting = false; search.query = query; search.loading = true; status = 'Searching tasks…'; if (!append) search.items = [];
      const params = new URLSearchParams({ filters: JSON.stringify({ title: query, parentScope: 'all', lifecycle: 'active' }), pageSize: '25' }); if (append) params.set('cursor', search.cursor); else search.cursor = null; render();
      try { const result = await api(`${base()}/tasks?${params}`); if (!current(s) || serial !== seq.search || !search) return; search.items = append ? search.items.concat(result.tasks || []) : result.tasks || []; search.cursor = result.hasMore ? result.nextCursor : null; status = 'Choose a task from the search results.'; }
      catch (error) { if (serial === seq.search) fail(error, s, true); }
      finally { if (current(s) && serial === seq.search && search) { search.loading = false; render(); } }
    }
    async function selectSearchTask(id) {
      if (!ready() || !search) return;
      const s = scope(), serial = ++seq.search, draftAtStart = generation, destination = clone(search.destination);
      search.selecting = true; preview = null; seq.preview++; status = 'Confirming the selected task…'; render();
      try { const result = await api(`${base()}/tasks/${encodeURIComponent(id)}`); if (!current(s) || serial !== seq.search || draftAtStart !== generation || !search) return; if (!result.task) throw new Error('This task is unavailable.'); taskLabels[id] = result.task.title; search = null;
        if (destination.sample) { sample = { id, title: result.task.title }; generation++; preview = null; seq.preview++; status = 'Sample confirmed. Preview again before activation.'; render(); }
        else editDefinition(definition => E.editNode(definition, destination.node, node => E.setAt(node, destination.path, { taskId: id })));
      } catch (error) { if (serial === seq.search) fail(error, s, true); }
      finally { if (current(s) && serial === seq.search && search) { search.selecting = false; render(); } }
    }
    async function loadHistory(kind, append = false) {
      if (!ready() || !rule || !['versions', 'runs'].includes(kind)) return;
      const s = scope(), serial = ++seq.history, ruleId = rule.ruleId;
      if (!append || history.kind !== kind) history = { kind, items: [], cursor: null };
      const query = new URLSearchParams({ pageSize: '25' }); if (append && history.cursor) query.set('cursor', history.cursor);
      try { const result = await api(`${base()}/automations/${encodeURIComponent(ruleId)}/${kind}?${query}`); if (!current(s) || serial !== seq.history || ruleId !== rule?.ruleId) return; history.items = append ? history.items.concat(result.items || []) : result.items || []; history.cursor = result.hasMore ? result.nextCursor : null; render(); }
      catch (error) { if (serial === seq.history) fail(error, s); }
    }
    async function showRun(id) {
      if (!ready() || !rule) return;
      const s = scope(), serial = ++seq.run, ruleId = rule.ruleId;
      try {
        const result = await api(`${base()}/automation-runs/${encodeURIComponent(id)}`);
        if (!current(s) || serial !== seq.run || ruleId !== rule?.ruleId) return;
        const versionResult = await api(`${base()}/automations/${encodeURIComponent(ruleId)}?versionId=${encodeURIComponent(result.run.versionId)}`);
        if (!current(s) || serial !== seq.run || ruleId !== rule?.ruleId) return;
        const order = new Map(), nodes = new Map(); E.walk(versionResult.version.definition, entry => { order.set(entry.path, order.size); nodes.set(entry.path, entry.node); });
        const failedPath = result.run.failedNode;
        const failedNode = nodes.get(failedPath) || [...nodes.values()].find(node => node.nodeId === failedPath);
        history.run = { failedStep: failedPath ? { label: R.labels[failedNode?.type] || 'Unavailable step', sequence: order.has(failedPath) ? order.get(failedPath) + 1 : null } : null, run: clone(result.run), actions: clone(result.actions || []).sort((a, b) => (order.get(a.path) ?? 999) - (order.get(b.path) ?? 999)) }; render();
      } catch (error) { if (serial === seq.run) fail(error, s); }
    }
    function acceptDraft(input, { newAutomation = false } = {}) {
      if (!ready() || input?.actorUid !== actorUid || input?.projectId !== projectId || pending) { status = 'This proposal does not match the current Owner and project.'; render(); return false; }
      opened = true;
      const errors = E.validate(input.definition, context); if (errors.length) { status = errors.join(' '); render(); return false; }
      if (newAutomation && dirty) { status = 'Save the current automation draft before opening this proposal.'; render(); return false; }
      if (newAutomation || !draft) newDraft(); changed({ ...draft, definition: clone(input.definition) }); opened = true; mode = 'edit'; render(); return true;
    }
    function handleField(control) {
      if (!ready() || !draft || control.closest('[data-auto-history-definition]')) return;
      const nodeId = control.dataset.autoNode || '', kind = control.dataset.autoKind || 'text';
      let path; try { path = JSON.parse(control.dataset.autoPath || '[]'); } catch (_) { return; }
      let value = kind === 'people' ? Array.from(control.selectedOptions).map(option => option.value) : kind === 'number' ? (control.value === '' ? null : Number(control.value)) : kind === 'minutes' ? Math.round(Number(control.value) * 60000) : kind === 'nullable' ? control.value || null : kind === 'optional' ? control.value || undefined : control.value;
      const updateObject = object => {
        if (kind === 'node-type') return { ...E.newNode(value, context), nodeId: object.nodeId };
        if (kind === 'trigger-kind') value = value === 'due_date' ? { type: value, time: '09:00', offsetDays: 0 } : { type: value };
        if (kind === 'target-kind') value = value === 'none' ? null : value === 'explicit' ? { taskId: '' } : 'trigger_task';
        if (kind === 'recipient-kind') value = value === 'explicit' ? [] : value;
        if (kind === 'condition-kind') { const old = E.getAt(object, path); value = value === 'none' ? undefined : value === 'leaf' ? E.leaf() : value === 'not' ? { not: old || E.leaf() } : { [value]: old?.all || old?.any || [old || E.leaf()] }; }
        if (kind === 'condition-field') { const field = value.startsWith('column:') ? { columnId: value.slice(7) } : value; return E.setAt(object, path.slice(0, -1), { field, operator: 'equals', value: E.defaultValue(E.fieldType(field, context), context, field) }); }
        if (kind === 'condition-operator') { const condition = E.getAt(object, path.slice(0, -1)), next = { ...condition, operator: value }; if (value === 'is_empty') delete next.value; else if (!('value' in next)) next.value = E.defaultValue(E.fieldType(next.field, context), context, next.field); return E.setAt(object, path.slice(0, -1), next); }
        if (kind === 'add-field') { if (!value) return object; const field = value.startsWith('column:') ? { columnId: value.slice(7) } : value, fieldPath = typeof field === 'string' ? [...path, field] : [...path, 'values', field.columnId]; if (E.getAt(object, fieldPath) !== undefined) return object; return E.setAt(object, fieldPath, value === 'assigneeUids' || E.fieldType(field, context) === 'people' && typeof field === 'object' ? [] : E.defaultValue(E.fieldType(field, context), context, field)); }
        return E.setAt(object, path, value);
      };
      editDefinition(definition => nodeId ? E.editNode(definition, nodeId, updateObject) : updateObject(definition));
    }
    function init() {
      button?.addEventListener('click', show);
      root?.addEventListener('input', event => { const control = event.target; if (control.dataset.autoPickerSearch && picker) { pickerQuery = control.value; render(); } else if (control.dataset.autoMeta && ready() && draft) updateDraft({ [control.dataset.autoMeta]: control.value }); else if (control.matches('input[data-auto-path],textarea[data-auto-path]')) handleField(control); });
      root?.addEventListener('change', event => { const control = event.target; if (control.dataset.autoMeta && control.tagName === 'SELECT' && ready() && draft) updateDraft({ [control.dataset.autoMeta]: control.value }); else if (control.matches('select[data-auto-kind]')) handleField(control); });
      root?.addEventListener('keydown', event => {
        if (!picker) return;
        if (event.key === 'Escape') { event.preventDefault(); closeSimplePicker(); return; }
        if (event.target.matches?.('[data-auto-picker-search]') && event.key === 'ArrowDown') {
          const first = root.querySelector?.(`[data-auto-picker="${picker}"] [role="option"]`);
          if (first) { event.preventDefault(); first.focus(); }
          return;
        }
        if (!event.target.matches?.(`[data-auto-picker="${picker}"] [role="option"]`) || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const choices = Array.from(root.querySelectorAll?.(`[data-auto-picker="${picker}"] [role="option"]`) || []), index = choices.indexOf(event.target);
        const next = choices[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length];
        if (next) { event.preventDefault(); next.focus(); }
      });
      root?.addEventListener('submit', event => { const form = event.target; if (!form.dataset.autoForm) return; event.preventDefault(); if (!ready()) return; const data = Object.fromEntries(new FormData(form)); if (form.dataset.autoForm === 'filters') setFilters(data); else searchTasks(data.query); });
      root?.addEventListener('click', event => {
        const control = event.target.closest('button[data-auto-action]'); if (!control || control.disabled || !ready() || control.closest('[data-auto-history-definition]')) return;
        const action = control.dataset.autoAction, id = control.dataset.nodeId;
        if (action === 'close') { opened = false; render(); }
        else if (action === 'open-manager') show();
        else if (action === 'manage') { mode = 'manage'; search = null; history.kind = ''; loadList(); }
        else if (action === 'create') showCreate();
        else if (action === 'create-from-scratch') newDraft();
        else if (action === 'simple-trigger') openSimplePicker('trigger');
        else if (action === 'simple-action') openSimplePicker('action');
        else if (action === 'simple-trigger-choice') chooseSimpleTrigger(control.dataset.autoChoice);
        else if (action === 'simple-action-choice') chooseSimpleAction(control.dataset.autoChoice);
        else if (action === 'close-picker') closeSimplePicker();
        else if (action === 'apply-recipe') {
          const recipe = E.RECIPES?.find(r => r.id === control.dataset.recipeId);
          if (recipe) {
            clearPanels(); seq.detail++; rule = null; version = null; baseDefinition = ''; sample = null; diagnostics = []; conflict = false;
            draft = { title: recipe.title, folder: '', actorUid, definition: recipe.create(context) };
            generation++; dirty = true; preview = null; picker = ''; pickerQuery = ''; representation = 'recipe'; mode = 'edit'; opened = true; render();
          }
        }
        else if (action === 'open-rule') openRule(control.dataset.ruleId);
        else if (action === 'more-rules') loadList(true);
        else if (['recipe', 'blocks'].includes(action)) setRepresentation(action);
        else if (action === 'save') mutate(rule ? 'save' : 'create');
        else if (['metadata', 'activate', 'disable', 'duplicate'].includes(action)) mutate(action);
        else if (action === 'retry-mutation') retryMutation();
        else if (action === 'preview') generatePreview();
        else if (action === 'refresh-rule') openRule(rule.ruleId, { preserveDraft: true });
        else if (action === 'sample-search') beginSearch();
        else if (action === 'task-search') beginSearch({ node: control.dataset.autoNode, path: JSON.parse(control.dataset.autoPath) });
        else if (action === 'choose-task') selectSearchTask(control.dataset.taskId);
        else if (action === 'more-tasks') searchTasks(search.query, true);
        else if (action === 'close-search') { seq.search++; search = null; render(); }
        else if (['versions', 'runs'].includes(action)) loadHistory(action);
        else if (action === 'more-history') loadHistory(history.kind, true);
        else if (action === 'close-history') { seq.history++; seq.run++; history = { kind: '', items: [], cursor: null }; render(); }
        else if (action === 'history-version') { history.selected = clone(history.items[Number(control.dataset.historyIndex)]); render(); }
        else if (action === 'history-run') showRun(history.items[Number(control.dataset.historyIndex)].runId);
        else if (action === 'add-step') editDefinition(definition => E.insert(definition, { parentId: control.dataset.parentId, branch: control.dataset.branch, context }));
        else if (action === 'remove-step') editDefinition(definition => E.remove(definition, id));
        else if (action === 'copy-step') editDefinition(definition => E.duplicate(definition, id));
        else if (action === 'move-up' || action === 'move-down') editDefinition(definition => E.reorder(definition, id, action === 'move-up' ? -1 : 1));
        else if (['condition-add', 'condition-remove', 'field-remove'].includes(action)) {
          const node = control.dataset.autoNode, path = JSON.parse(control.dataset.autoPath);
          const change = object => { if (action === 'condition-add') return E.setAt(object, path, [...E.getAt(object, path), E.leaf()]); if (action === 'condition-remove') { const parent = path.slice(0, -1), list = E.getAt(object, parent).slice(); list.splice(path.at(-1), 1); return E.setAt(object, parent, list); } return E.setAt(object, path, undefined); };
          editDefinition(definition => node ? E.editNode(definition, node, change) : change(definition));
        }
      }); render();
    }
    function render() {
      if (button) { button.hidden = !owner(); button.disabled = !ready(); }
      if (!root) return;
      if (!projectId || !context.project) {
        root.hidden = false;
        root.innerHTML = '<div class="crm-workspace-card" style="padding: 16px; margin: 12px 0;"><h4 style="margin: 0 0 8px;">Automations</h4><p class="crm-muted" style="margin: 0;">Select an active project to view and configure automation rules.</p></div>';
        return;
      }
      if (!owner()) {
        const userRole = context.membership?.role || 'Viewer';
        root.hidden = false;
        root.innerHTML = `<div class="crm-workspace-card" style="padding: 16px; margin: 12px 0;"><h4 style="margin: 0 0 8px;">Automations</h4><p class="crm-muted" style="margin: 0;">Automations are configured by Project Owners. You have <strong>${R.esc(userRole)}</strong> access to this project.</p></div>`;
        return;
      }
      if (!opened) {
        root.hidden = false;
        root.innerHTML = `<div class="crm-workspace-card" style="padding: 16px; margin: 12px 0;"><h4 style="margin: 0 0 8px;">Project Automations</h4><p class="crm-muted" style="margin: 0 0 12px;">Automate task updates, status transitions, and notifications.</p><button type="button" class="crm-btn-primary crm-btn-sm" data-auto-action="open-manager"${!ready() ? ' disabled' : ''}>Configure automations</button></div>`;
        return;
      }
      root.hidden = false;
      const active = root.ownerDocument?.activeElement;
      const focus = active && root.contains(active) ? { id: active.id, node: active.dataset.autoNode, path: active.dataset.autoPath, kind: active.dataset.autoKind, action: active.dataset.autoAction, nodeId: active.dataset.nodeId, ruleId: active.dataset.ruleId, taskId: active.dataset.taskId, parentId: active.dataset.parentId, branch: active.dataset.branch, historyIndex: active.dataset.historyIndex, form: active.form?.dataset.autoForm, name: active.name, start: active.selectionStart, end: active.selectionEnd } : null;
      const e = R.esc, b = R.button, ctx = { ...context, taskLabels }, locked = inFlight || !!pending || conflict;
      const actorName = id => context.members?.find(person => person.uid === id)?.displayName || id || 'Not specified';
      const competingWarnings = E.detectCompetingRules ? E.detectCompetingRules(items) : [];
      const competingBanner = competingWarnings.length ? `<div class="crm-auto-warning is-competing"><strong><svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5 14.2 13H1.8z"/><path d="M8 6.6v3.1M8 11.4h.01"/></svg> Competing Rules Warning:</strong><ul style="margin: 4px 0 0; padding-left: 18px;">${competingWarnings.map(w => `<li>${e(w.message)}</li>`).join('')}</ul></div>` : '';
      const recipeGallery = E.RECIPES ? `<div class="crm-auto-recipes" style="margin: 12px 0; padding: 12px; background: var(--pj-raised); border-radius: 8px;"><h4 style="margin:0 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--pj-faint);">Recommended Recipes</h4><div style="display:flex; flex-wrap:wrap; gap:8px;">${E.RECIPES.map(r => `<button type="button" class="crm-btn-secondary crm-btn-sm" data-auto-action="apply-recipe" data-recipe-id="${e(r.id)}" title="${e(r.description)}">+ ${e(r.title)}</button>`).join('')}</div></div>` : '';
      const manage = `${recipeGallery}${competingBanner}<form data-auto-form="filters" class="crm-auto-fields">${R.input('Search automations', filters.query, 'name="query"', 'search', 'maxlength="200"')}${R.select('Folder', [{ value: 'all', label: 'All folders' }, { value: 'unfiled', label: 'Unfiled' }, { value: 'named', label: 'Named folder' }], filters.folderMode, 'name="folderMode"')}${R.input('Folder name', filters.folder, 'name="folder"', 'text', 'maxlength="200"')}${R.select('State', [{ value: '', label: 'All' }, { value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }], filters.enabled, 'name="enabled"')}<button class="crm-btn-primary" type="submit">Find automations</button></form><ul class="crm-auto-manage-list">${items.map(item => `<li><div><strong>${e(item.title)}</strong><p>${e(item.folder || 'Unfiled')} · ${item.enabled ? 'Enabled' : 'Disabled'} · Active actor: ${e(actorName(item.activeActorUid))} · Draft actor: ${e(actorName(item.draftActorUid))}</p><span class="crm-muted">References not checked yet</span></div>${b('open-rule', 'Open', `data-rule-id="${e(item.ruleId)}"`)}</li>`).join('') || `<li>${loading ? 'Loading automations…' : cursor ? 'No matches in this page. Load more to continue.' : 'No matching automations.'}</li>`}</ul>${cursor ? b('more-rules', 'Load more automations') : ''}`;
      const manageSurface = manage.replace(recipeGallery, '');
      const createGallery = `<section class="crm-auto-create-gallery" aria-labelledby="crm-auto-create-title"><div class="crm-auto-gallery-intro"><span class="crm-eyebrow">Create</span><h4 id="crm-auto-create-title">Start with a recipe</h4><p>Choose a supported starting point, or build a rule from scratch.</p></div><div class="crm-auto-recipe-grid">${(E.RECIPES || []).map(recipe => `<article class="crm-auto-recipe-card"><h5>${e(recipe.title)}</h5><p>${e(recipe.description)}</p>${b('apply-recipe', 'Use recipe', `data-recipe-id="${e(recipe.id)}"`)}</article>`).join('')}<article class="crm-auto-recipe-card is-blank"><h5>From scratch</h5><p>Choose the trigger and action yourself. Nothing is preselected.</p>${b('create-from-scratch', 'Build from scratch')}</article></div></section>`;
      if (mode === 'create') {
        root.innerHTML = `<header class="crm-auto-heading"><div><span class="crm-eyebrow">Project automation</span><h3>${e(context.project?.name || 'Project')} · Create</h3></div><div class="crm-inline-fields">${b('manage', 'Manage', 'aria-pressed="false"')}${b('close', 'Close')}</div></header><p data-auto-status role="status">${e(status)}</p><fieldset class="crm-auto-surface"><legend class="sr-only">Create automation</legend>${createGallery}</fieldset>`;
        return;
      }
      let editor = '';
      if (draft) {
        const errors = validation();
        const definitionMarkup = representation === 'recipe' && R.simpleDefinition ? R.simpleDefinition(draft.definition, ctx, { picker, query: pickerQuery }) : R.definition(draft.definition, ctx, representation);
        editor = `<details class="crm-auto-metadata"><summary>Rule details</summary><div class="crm-auto-fields">${R.input('Automation title', draft.title, 'id="auto-title" data-auto-meta="title"', 'text', 'maxlength="200"')}${R.input('Folder', draft.folder, 'id="auto-folder" data-auto-meta="folder"', 'text', 'maxlength="200"')}<label>Run as Owner<select class="crm-input" id="auto-actor" data-auto-meta="actorUid"${!rule ? ' disabled' : ''}>${R.options((context.members || []).filter(person => person.role === 'Owner').map(person => ({ value: person.uid, label: person.displayName || person.email || person.uid })), draft.actorUid)}</select><span class="crm-muted">Changing the actor creates a new version when saved.</span></label></div></details><nav class="crm-auto-representations" aria-label="Editor representation">${b('recipe', 'Builder', `aria-pressed="${representation === 'recipe'}"`)}${b('blocks', 'Advanced', `aria-pressed="${representation === 'blocks'}"`)}</nav>${diagnostics.map(item => `<p class="crm-auto-warning">${e(item.message || 'A saved reference needs repair.')}</p>`).join('')}${definitionMarkup}${errors.length ? `<details class="crm-auto-validation"><summary>${errors.length} items to review before saving</summary><ul>${errors.map(error => `<li>${e(error)}</li>`).join('')}</ul></details>` : ''}<div class="crm-auto-actions"><div class="crm-auto-primary-actions">${b('save', rule ? 'Save new version' : 'Save automation', locked || errors.length ? 'disabled' : '')}</div><details class="crm-auto-advanced-actions"><summary>Preview and lifecycle</summary><div class="crm-auto-action-grid">${rule ? b('metadata', 'Save title / folder', locked ? 'disabled' : '') : ''}${b('sample-search', sample ? `Sample: ${sample.title}` : 'Choose sample task')}${b('preview', 'Preview effects', dirty || !sample || !version || search?.selecting || locked ? 'disabled' : '')}${b('activate', 'Activate this version', !preview || dirty || locked ? 'disabled' : '')}${rule ? b('disable', 'Disable automation', !rule.enabled || locked ? 'disabled' : '') + b('duplicate', 'Create disabled copy', locked ? 'disabled' : '') + b('refresh-rule', 'Refresh current revision', pending || inFlight ? 'disabled' : '') + b('versions', 'Version history') + b('runs', 'Run history') : ''}</div></details></div><section data-auto-preview aria-label="Effect preview">${R.preview(preview, ctx)}</section>`;
      }
      const searchUi = search ? `<section class="crm-auto-task-search" aria-label="Find task"><h4>${search.destination.sample ? 'Choose a sample task' : 'Choose target task'}</h4><form data-auto-form="task-search">${R.input('Task title', search.query, 'name="query"', 'search', 'maxlength="200"')}<button class="crm-btn-primary" type="submit">Search tasks</button></form><ul>${search.items.map(task => `<li>${e(task.title)} ${b('choose-task', 'Choose', `data-task-id="${e(task.id)}"`)}</li>`).join('') || '<li>Search to find a current task.</li>'}</ul>${search.cursor ? b('more-tasks', 'Load more tasks') : ''}${b('close-search', 'Close task search')}</section>` : '';
      let historyUi = '';
      if (history.kind) {
        historyUi = `<section class="crm-auto-history" aria-label="Automation history"><h4>${history.kind === 'versions' ? 'Immutable versions' : 'Runs'}</h4><ul>${history.items.map((item, index) => `<li>${e(history.kind === 'versions' ? `${item.createdAt || ''} · ${actorName(item.actorUid)}` : `${item.createdAt || ''} · ${item.state || ''}`)} ${b(history.kind === 'versions' ? 'history-version' : 'history-run', 'Inspect', `data-history-index="${index}"`)}</li>`).join('') || '<li>No history yet.</li>'}</ul>${history.cursor ? b('more-history', 'Load more history') : ''}`;
        if (history.selected) historyUi += `<div data-auto-history-definition>${R.definition(history.selected.definition, ctx, 'blocks', true)}</div>`;
        if (history.run) historyUi += `<p>Run: ${e(history.run.run.state)}${history.run.run.errorCode ? ` · ${e(history.run.run.errorCode)}` : ''}</p>${history.run.failedStep ? `<p class="crm-auto-warning">Failed step${history.run.failedStep.sequence ? ` ${history.run.failedStep.sequence}` : ''}: ${e(history.run.failedStep.label)}</p>` : ''}<ol>${history.run.actions.map(action => `<li>${e(R.labels[action.type || action.effect?.type] || 'Action')} · ${e(action.state)}${action.choice ? ` · ${e(action.choice)}` : ''}${action.resumeAt ? ` · Resume ${e(action.resumeAt)}` : ''}${action.errorCode ? ` · ${e(action.errorCode)}` : ''}</li>`).join('')}</ol>`;
        historyUi += b('close-history', 'Close history') + '</section>';
      }
      root.innerHTML = `<header class="crm-auto-heading"><div><span class="crm-eyebrow">Project automation</span><h3>${e(context.project?.name || 'Project')} · Automate</h3></div><div class="crm-inline-fields">${b('manage', 'Manage', `aria-pressed="${mode === 'manage'}"`)}${b('create', 'Create')}${b('close', 'Close')}</div></header><p data-auto-status role="status">${e(status)}</p>${pending ? `<p class="crm-auto-warning">An earlier change needs acknowledgement. Newer edits are kept.</p>${b('retry-mutation', inFlight ? 'Waiting for acknowledgement…' : 'Retry original change', inFlight ? 'disabled' : '')}` : ''}<fieldset class="crm-auto-surface"${!ready() ? ' disabled' : ''}><legend class="sr-only">Automation workspace</legend>${mode === 'manage' ? manageSurface : editor}${searchUi}${historyUi}</fieldset>`;
      if (focusPickerSearch) {
        root.querySelector?.('[data-auto-picker-search]')?.focus?.({ preventScroll: true });
        focusPickerSearch = false;
      } else if (pickerRestore) {
        root.querySelector?.(`[data-auto-action="simple-${pickerRestore}"]`)?.focus?.({ preventScroll: true });
        pickerRestore = '';
      } else if (focus) {
        const target = Array.from(root.querySelectorAll('input,select,textarea,button')).find(control => {
          if (focus.id) return control.id === focus.id;
          if (focus.path !== undefined || focus.kind !== undefined) return control.dataset.autoNode === focus.node && control.dataset.autoPath === focus.path && control.dataset.autoKind === focus.kind;
          if (focus.action) return control.dataset.autoAction === focus.action && ['nodeId', 'ruleId', 'taskId', 'parentId', 'branch', 'historyIndex'].every(key => control.dataset[key] === focus[key]);
          return !!focus.name && !!focus.form && control.name === focus.name && control.form?.dataset.autoForm === focus.form;
        });
        if (target) { target.focus({ preventScroll: true }); if (focus.start !== null && focus.start !== undefined && typeof target.setSelectionRange === 'function') { try { target.setSelectionRange(focus.start, focus.end); } catch (_) { /* Native selects have no caret. */ } } }
      }
    }
    return { init, setAccount, setSelection, setContext, show, newDraft, showCreate, openSimplePicker, closeSimplePicker, chooseSimpleTrigger, chooseSimpleAction, loadList, setFilters, openRule, updateDraft, editDefinition, setRepresentation, mutate, retryMutation, generatePreview, beginSearch, searchTasks, selectSearchTask, loadHistory, showRun, acceptDraft, getState: state };
  }
  globalScope.CrmAutomations = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
