(function (globalScope) {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const operationId = () => `crm-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function createController(deps = {}) {
    const root = deps.elements?.projectsBoardRecovery;
    const api = deps.apiFetchJson;
    const el = (name) => root?.querySelector(`[data-recovery-${name}]`);
    let selection = null, epoch = 0, catalogSequence = 0, previewSequence = 0, historySequence = 0;
    let entries = [], operations = [], cursor = null, historyCursor = null, preview = null, pending = false;
    let catalogLoaded = false, catalogLoading = false;
    let executionSequence = 0, interactionSequence = 0, activeRequest = null;
    const selectedTasks = new Map(), retries = new Map();
    const currentUid = () => String(deps.getCurrentUser?.()?.uid || '');
    const retryKey = (actorUid, projectId) => JSON.stringify([actorUid, projectId]);
    const storageKey = (actorUid, projectId) => JSON.stringify(['crm-projects-recovery', actorUid, projectId]);
    const selectionKey = () => selection ? retryKey(selection.actorUid, selection.projectId) : '';
    function rememberRetry(request, remove = false) {
      // The captured actor owns cleanup even after the live account changes.
      const key = retryKey(request.actorUid, request.projectId);
      const storage = storageKey(request.actorUid, request.projectId);
      if (remove) {
        if (retries.get(key) !== request) return false;
        retries.delete(key);
      } else retries.set(key, request);
      try { if (remove) sessionStorage.removeItem(storage); else sessionStorage.setItem(storage, JSON.stringify(request)); } catch (_) { /* In-memory retry remains available. */ }
      return true;
    }
    function restoreRetry(actorUid, projectId) {
      const key = retryKey(actorUid, projectId);
      if (!actorUid || retries.has(key)) return;
      try {
        const request = JSON.parse(sessionStorage.getItem(storageKey(actorUid, projectId)) || 'null');
        if (request && (!request.actorUid || request.actorUid === actorUid) && (!request.projectId || request.projectId === projectId)
            && typeof request.path === 'string' && request.path.startsWith(`/api/projects/${encodeURIComponent(projectId)}/`) && typeof request.body === 'string') {
          retries.set(key, Object.freeze({ ...request, actorUid, projectId }));
        }
      } catch (_) { /* Ignore invalid local retry state. */ }
    }
    const path = () => `/api/projects/${encodeURIComponent(selection.projectId)}`;
    const captureScope = () => selection ? { epoch, actorUid: selection.actorUid, projectId: selection.projectId } : null;
    const currentTuple = (scope) => !!scope && !!selection && scope.actorUid === selection.actorUid && scope.actorUid === currentUid() && scope.projectId === selection.projectId;
    const current = (scope) => currentTuple(scope) && scope.epoch === epoch;
    const writable = () => !!selection?.actorUid && selection.actorUid === currentUid() && ['Owner', 'Editor'].includes(selection.role);
    function status(text) { if (el('status')) el('status').textContent = text; }
    function controls() {
      if (!root) return;
      root.hidden = !selection;
      root.querySelectorAll('button,input,select').forEach((item) => { item.disabled = pending || item.hasAttribute('data-denied'); });
      const unresolved = retries.has(selectionKey());
      if (el('label')) el('label').textContent = `Project records, Archive, Trash and history${unresolved ? ' — Interrupted change: open to retry' : ''}`;
      root.querySelectorAll('[data-action],[data-undo]').forEach((item) => { item.disabled = item.disabled || unresolved; });
      if (el('apply')) el('apply').disabled = pending || unresolved || !preview?.allowed;
      if (el('bulk')) el('bulk').disabled = pending || unresolved || !writable() || !selectedTasks.size;
      if (el('retry')) { el('retry').hidden = !retries.has(selectionKey()); el('retry').disabled = pending || !writable(); }
      if (el('count')) el('count').textContent = `${selectedTasks.size} selected (maximum 100)`;
    }
    function renderCatalog() {
      if (!el('entries')) return;
      el('entries').innerHTML = entries.map((entry, i) => `<li class="crm-projects-recovery-row">${entry.targetType === 'task' && entry.lifecycle === 'active' && writable() ? `<input type="checkbox" data-select="${i}" aria-label="Select ${esc(entry.title)}"${selectedTasks.has(entry.targetId) ? ' checked' : ''}>` : ''}<div><strong>${esc(entry.title)}</strong><span class="crm-muted">${esc((entry.ancestorPaths || []).map((a) => a.title).join(' → '))} · ${esc(entry.lifecycle)}</span></div><div class="crm-inline-fields">${['archive', 'trash', 'restore'].map((action) => `<button type="button" class="crm-btn-secondary crm-btn-sm" data-action="${action}" data-entry="${i}"${entry.allowedActions?.[action] ? '' : ' data-denied disabled'}>${action === 'trash' ? 'Move to Trash' : action[0].toUpperCase() + action.slice(1)}</button>`).join('')}</div></li>`).join('') || '<li>No records in this view.</li>';
      el('more').hidden = !cursor;
      controls();
    }
    async function catalog(append = false, options = {}) {
      if (!selection || !api || (options.current && !options.current())) return;
      const scope = captureScope(), sequence = ++catalogSequence;
      const canPublish = () => current(scope) && sequence === catalogSequence && (!options.current || options.current());
      if (!el('disclosure')?.open) { catalogLoaded = false; catalogLoading = false; return; }
      catalogLoading = true;
      if (!append && !options.preserveSelection) { previewSequence += 1; preview = null; renderPreview(); entries = []; selectedTasks.clear(); cursor = null; renderCatalog(); }
      const query = new URLSearchParams({ lifecycle: el('lifecycle').value, targetType: el('type').value, limit: '50' });
      if (append && cursor) query.set('cursor', cursor);
      try {
        const result = await api(`${path()}/recovery?${query}`);
        if (!canPublish()) return;
        entries = append ? entries.concat(result.entries || []) : result.entries || [];
        cursor = result.hasMore ? result.nextCursor : null;
        catalogLoaded = true;
        if (!append && options.preserveSelection) {
          const eligible = new Map(entries.filter((entry) => entry.targetType === 'task' && entry.lifecycle === 'active' && writable()).map((entry) => [entry.targetId, entry]));
          for (const id of selectedTasks.keys()) { if (eligible.has(id)) selectedTasks.set(id, eligible.get(id)); else selectedTasks.delete(id); }
        } else if (!append) selectedTasks.clear();
        renderCatalog(); if (!options.quiet) status(`${entries.length} records loaded.`);
      } catch (error) { if (canPublish() && !options.quiet) status(error.message || 'Recovery records could not be loaded. Refresh this view.'); }
      finally { if (current(scope) && sequence === catalogSequence) catalogLoading = false; }
    }
    function renderPreview() {
      if (!el('preview')) return;
      el('preview').hidden = !preview;
      if (!preview) { el('preview').innerHTML = ''; return; }
      const changes = (preview.affected || []).map((item) => `<li>${esc(item.title)}: ${esc(item.fromLifecycle)} → ${esc(item.toLifecycle)}</li>`).join('');
      el('preview').innerHTML = `<h5>${esc(preview.action)}: ${esc(preview.target?.title)}</h5><p>Record lifecycle: ${esc(preview.target?.localLifecycle)}. Effective lifecycle including ancestors: ${esc(preview.target?.lifecycle)}.</p><p>${esc((preview.target?.ancestorPaths || []).filter((a) => a.lifecycle !== "active").map((a) => `${a.title} (${a.lifecycle})`).join(" → "))}</p><ul>${changes || '<li>No changes are currently permitted.</li>'}</ul>${preview.action === 'restore' ? `<label><input type="checkbox" data-recovery-chain${preview.restoreChain ? ' checked' : ''}${selection.role === 'Owner' || !preview.chainRequiresOwner ? '' : ' data-denied disabled'}> Restore unavailable ancestors${preview.chainRequiresOwner ? ' (Owner required)' : ''}</label>${preview.entry.targetType === 'task' ? `<label>Restore into active section <select data-recovery-destination class="crm-input"><option value="">Keep original location</option>${(preview.destinationOptions || []).map((item) => `<option value="${esc(item.id)}"${preview.destinationSectionId === item.id ? ' selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label>` : ''}` : ''}<p>${preview.allowed ? 'Review these changes before applying.' : esc(preview.reason || 'This action needs a valid active destination or an Owner to restore its ancestors.')}</p><div class="crm-inline-fields"><button type="button" data-recovery-apply class="crm-btn-primary">Apply changes</button><button type="button" data-recovery-cancel class="crm-btn-secondary">Cancel</button></div>`;
      controls();
    }
    async function loadPreview(entry, action, options = {}) {
      if (!entry || !selection || pending) return;
      const scope = captureScope(), sequence = ++previewSequence;
      preview = null; renderPreview();
      const query = new URLSearchParams({ targetType: entry.targetType, targetId: entry.targetId, action, restoreChain: String(!!options.restoreChain) });
      if (options.destinationSectionId) query.set('destinationSectionId', options.destinationSectionId);
      try {
        const result = await api(`${path()}/recovery/preview?${query}`);
        if (!current(scope) || sequence !== previewSequence) return;
        preview = { ...result, entry, action, restoreChain: !!options.restoreChain, destinationSectionId: options.destinationSectionId || null }; renderPreview();
      } catch (error) { if (current(scope) && sequence === previewSequence) status(error.message || 'Preview could not be loaded.'); }
    }
    async function history(append = false, options = {}) {
      if (!selection || !el('disclosure')?.open || (options.current && !options.current())) return;
      const scope = captureScope(), sequence = ++historySequence;
      const canPublish = () => current(scope) && sequence === historySequence && (!options.current || options.current());
      const query = new URLSearchParams({ limit: '25' });
      if (append && historyCursor) query.set('cursor', historyCursor);
      try {
        const result = await api(`${path()}/history?${query}`);
        if (!canPublish()) return;
        operations = append ? operations.concat(result.operations || []) : result.operations || [];
        historyCursor = result.hasMore ? result.nextCursor : null;
        el('history-list').innerHTML = operations.map((entry, i) => `<li class="crm-projects-recovery-row"><div><strong>${esc(entry.command)}</strong><span>${esc(entry.actorUid)} · ${esc(entry.createdAt)}</span><span class="crm-muted">${esc((entry.affectedIds || []).join(', '))}</span></div><button type="button" data-undo="${i}" class="crm-btn-secondary crm-btn-sm"${entry.canUndo ? '' : ' data-denied disabled'}>Undo</button></li>`).join('') || '<li>No project history yet.</li>';
        el('history-more').hidden = !historyCursor; controls();
      } catch (error) { if (canPublish() && !options.quiet) status(error.message || 'History could not be loaded.'); }
    }
    async function execute(request) {
      if (!request || !selection || pending || !writable()) return;
      const scope = captureScope();
      if (request.actorUid && (request.actorUid !== scope.actorUid || request.projectId !== scope.projectId)) return;
      if (retries.has(selectionKey()) && retries.get(selectionKey()) !== request) return;
      request = request.actorUid ? request : Object.freeze({ ...request, actorUid: scope.actorUid, projectId: scope.projectId });
      const submittedPreview = preview, token = ++executionSequence, startedInteraction = interactionSequence;
      activeRequest = request;
      const ownsExecution = () => current(scope) && token === executionSequence && activeRequest === request;
      const ownsStatus = () => ownsExecution() && startedInteraction === interactionSequence;
      rememberRetry(request); pending = true; controls(); status('Applying changes…');
      try {
        let failure = null;
        try { await api(request.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: request.body }); }
        catch (error) { failure = error; }
        const known = failure && Number(failure.status) >= 400 && Number(failure.status) < 500;
        if (failure && !known) {
          // A concurrent exact replay may already have settled this request.
          if (retries.get(retryKey(request.actorUid, request.projectId)) === request && ownsStatus()) status(`${failure.message || 'Request interrupted.'} Retry sends the exact same request.`);
          return;
        }
        if (!rememberRetry(request, true) || !currentTuple(scope)) return;
        controls();
        const freshScope = captureScope(), freshToken = executionSequence;
        const canReconcile = () => current(freshScope) && freshToken === executionSequence
          && (!pending || activeRequest === request);
        if (!canReconcile()) return;
        if (preview === submittedPreview) { previewSequence += 1; preview = null; renderPreview(); }
        // Refresh the revisited tuple, but only publish while it still owns this
        // reconciliation. Catalog rows replace retained selection snapshots.
        if (!failure) await deps.refreshBoard?.();
        if (!canReconcile()) return;
        await catalog(false, { current: canReconcile, preserveSelection: true, quiet: true });
        if (!canReconcile()) return;
        await history(false, { current: canReconcile, quiet: true });
        if (canReconcile() && ownsStatus()) status(failure ? `${failure.message || 'Request rejected.'} Review fresh records and choose the action again.` : 'Changes saved.');
      } catch (error) {
        if (ownsStatus()) status(`${error.message || 'Records could not be refreshed.'} Refresh records to review the settled request.`);
      } finally {
        if (ownsExecution()) {
          pending = false; activeRequest = null; controls();
          if (startedInteraction === interactionSequence && !retries.has(selectionKey()) && el('status')?.textContent === 'Applying changes…') status('');
        }
      }
    }
    function apply() {
      if (!preview?.allowed) return;
      const { entry, action } = preview;
      const suffix = entry.targetType === 'project' ? '' : `/${entry.targetType === 'task' ? 'tasks' : 'sections'}/${encodeURIComponent(entry.targetId)}`;
      execute({ path: `${path()}${suffix}/${action}`, body: JSON.stringify({ operationId: operationId(), expectedRevision: preview.expectedRevision, expectedStructureRevision: preview.expectedStructureRevision, expectedAncestorRevisions: preview.expectedAncestorRevisions, restoreChain: preview.restoreChain, destinationSectionId: preview.destinationSectionId }) });
    }
    function setSelection(next) {
      const actorUid = currentUid();
      const projectChanged = actorUid !== selection?.actorUid || next?.projectId !== selection?.projectId;
      const key = next?.projectId && actorUid ? JSON.stringify([actorUid, next.projectId, next.role]) : '';
      const previousKey = selection ? JSON.stringify([selection.actorUid, selection.projectId, selection.role]) : '';
      selection = next?.projectId && actorUid ? { ...next, actorUid } : null;
      if (selection) restoreRetry(actorUid, selection.projectId);
      if (key !== previousKey) {
        epoch += 1; catalogSequence += 1; previewSequence += 1; historySequence += 1;
        executionSequence += 1; activeRequest = null;
        pending = false; entries = []; operations = []; selectedTasks.clear(); cursor = null; historyCursor = null; preview = null;
        catalogLoaded = false; catalogLoading = false;
        if (projectChanged && el('disclosure')) el('disclosure').open = !!selection && selection.lifecycle !== 'active' && !!selection.lifecycle;
        if (el('history-list')) el('history-list').innerHTML = '';
        renderCatalog(); renderPreview(); status(''); if (selection && el('disclosure')?.open) catalog();
      }
      controls();
    }
    function init() {
      if (!root) return;
      root.innerHTML = `<details data-recovery-disclosure><summary data-recovery-toggle><span data-recovery-label>Project records, Archive, Trash and history</span></summary><div class="crm-projects-recovery-content"><div class="crm-inline-fields"><label>Lifecycle <select data-recovery-lifecycle class="crm-input"><option value="active">Active</option><option value="archived">Archive</option><option value="trashed">Trash</option></select></label><label>Record type <select data-recovery-type class="crm-input"><option value="task">Tasks</option><option value="section">Sections</option><option value="project">Project</option></select></label><button type="button" data-recovery-refresh class="crm-btn-secondary">Refresh records</button><button type="button" data-recovery-history class="crm-btn-secondary">Project history</button><button type="button" data-recovery-retry class="crm-btn-secondary" hidden>Retry interrupted change</button></div><p data-recovery-status id="projects-board-recovery-status" role="status"></p><ul data-recovery-entries class="crm-projects-recovery-list"></ul><button type="button" data-recovery-more class="crm-btn-secondary" hidden>Load more records</button><div class="crm-inline-fields"><span data-recovery-count></span><label>Selected tasks status <select data-recovery-bulk-status class="crm-input"><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select></label><button type="button" data-recovery-bulk class="crm-btn-secondary">Update selected tasks</button></div><section data-recovery-preview aria-label="Recovery impact preview" hidden></section><ol data-recovery-history-list class="crm-projects-recovery-list"></ol><button type="button" data-recovery-history-more class="crm-btn-secondary" hidden>Load more project history</button></div></details>`;
      el('disclosure').addEventListener('toggle', () => {
        if (el('disclosure').open && selection && !catalogLoaded && !catalogLoading) catalog();
      });
      root.addEventListener('change', (event) => {
        interactionSequence += 1;
        if (event.target.matches('[data-recovery-lifecycle],[data-recovery-type]')) { preview = null; renderPreview(); catalog(); }
        if (event.target.matches('[data-select]')) { const entry = entries[Number(event.target.dataset.select)]; if (event.target.checked && selectedTasks.size < 100) selectedTasks.set(entry.targetId, entry); else { selectedTasks.delete(entry.targetId); event.target.checked = false; } controls(); }
        if (event.target.matches('[data-recovery-chain],[data-recovery-destination]') && preview) loadPreview(preview.entry, preview.action, { restoreChain: !!el('chain')?.checked, destinationSectionId: el('destination')?.value || null });
      });
      root.addEventListener('click', (event) => {
        interactionSequence += 1;
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        if (button.hasAttribute('data-action')) loadPreview(entries[Number(button.dataset.entry)], button.dataset.action);
        else if (button.hasAttribute('data-recovery-apply')) apply();
        else if (button.hasAttribute('data-recovery-cancel')) { previewSequence += 1; preview = null; renderPreview(); }
        else if (button.hasAttribute('data-recovery-refresh')) catalog();
        else if (button.hasAttribute('data-recovery-more')) catalog(true);
        else if (button.hasAttribute('data-recovery-history')) history();
        else if (button.hasAttribute('data-recovery-history-more')) history(true);
        else if (button.hasAttribute('data-recovery-retry')) execute(retries.get(selectionKey()));
        else if (button.hasAttribute('data-undo')) { const entry = operations[Number(button.dataset.undo)]; if (entry?.canUndo) execute({ path: `${path()}/operations/${encodeURIComponent(entry.operationId)}/undo`, body: JSON.stringify({ operationId: operationId() }) }); }
        else if (button.hasAttribute('data-recovery-bulk') && selectedTasks.size && selectedTasks.size <= 100) execute({ path: `${path()}/tasks/bulk`, body: JSON.stringify({ operationId: operationId(), changes: Array.from(selectedTasks.values()).map((entry) => ({ taskId: entry.targetId, expectedRevision: entry.revision, patch: { status: el('bulk-status').value } })) }) });
      });
      controls();
    }
    return { init, setSelection, refresh: catalog, getState: () => ({ selection, pending, entries: entries.slice(), preview, selectedTasks: Array.from(selectedTasks.values()) }) };
  }
  const api = { createController, setSelection: () => {} };
  globalScope.CrmProjectsRecovery = api;
  api.createController = (deps) => { const controller = createController(deps); api.setSelection = controller.setSelection; return controller; };
})(typeof window !== 'undefined' ? window : globalThis);
