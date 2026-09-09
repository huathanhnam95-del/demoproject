(function (globalScope) {
  'use strict';
  const categories = ['assignment', 'discussion', 'deadline', 'automation'];
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const copy = (v) => JSON.parse(JSON.stringify(v));
  function createController(deps = {}) {
    const root = deps.root, api = deps.apiFetchJson;
    let actor = '', epoch = 0, feedSequence = 0, prefsSequence = 0, openSequence = 0;
    let items = [], cursor = null, loading = false, status = '', projects = [], blocked = new Set();
    let filters = { projectId: '', category: '', unread: '' }, revision = null, muted = [], draft = [], dirty = false, conflict = false, prefsLoading = false, prefsSaving = false, prefsStatus = '';
    const reading = new Set();
    const uid = () => String(deps.getCurrentUser?.()?.uid || '');
    const scope = () => ({ actor, epoch });
    const current = (s) => !!s.actor && s.actor === actor && s.actor === uid() && s.epoch === epoch;
    const el = (name) => root?.querySelector(`[data-notifications-${name}]`);
    const options = (all) => `${all ? '<option value="">All projects</option>' : '<option value="">Choose project</option>'}${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.title || 'Project')}</option>`).join('')}`;
    function syncBadge() {
      const doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const badge = doc?.getElementById?.('projects-notifications-badge');
      if (!badge) return;
      const unreadCount = items.filter((item) => !item.read).length;
      badge.textContent = String(unreadCount);
      badge.hidden = unreadCount === 0;
    }
    function render() {
      if (!root) return;
      root.hidden = !actor;
      syncBadge();
      if (el('status')) el('status').textContent = status;
      if (el('list')) el('list').innerHTML = items.map((item) => `<li class="crm-projects-notification-row${item.read ? '' : ' is-unread'}"><div><span class="crm-muted">${esc(item.category)} · ${esc(item.createdAt)}</span><p>${item.available ? esc(item.message || 'Project update') : 'This update is no longer available.'}</p>${item.available && item.taskLabel ? `<strong>${esc(item.taskLabel)}</strong>` : ''}</div><div class="crm-inline-fields">${item.available ? `<button type="button" class="crm-btn-secondary" data-notification-open="${esc(item.notificationId)}">Open</button>` : ''}<button type="button" class="crm-btn-secondary" data-notification-read="${esc(item.notificationId)}"${reading.has(item.notificationId) ? ' disabled' : ''}>Mark ${item.read ? 'unread' : 'read'}</button></div></li>`).join('') || `<li>${loading ? 'Loading updates…' : cursor ? 'No accessible matches on this page. Load more to continue.' : 'No updates in this view.'}</li>`;
      if (el('more')) { el('more').hidden = !cursor; el('more').disabled = loading; }
      if (el('refresh')) el('refresh').disabled = loading;
      if (el('prefs-status')) el('prefs-status').textContent = prefsStatus;
      if (el('save')) el('save').disabled = !dirty || revision === null || prefsLoading || prefsSaving || conflict;
      if (el('prefs-refresh')) el('prefs-refresh').disabled = prefsLoading || prefsSaving;
      if (el('mute-list')) el('mute-list').innerHTML = draft.map((entry, i) => `<li>${esc(projects.find((p) => p.id === entry.projectId)?.name || projects.find((p) => p.id === entry.projectId)?.title || 'Project')} · ${esc(entry.category)} <button type="button" class="crm-btn-secondary" data-notification-unmute="${i}"${prefsSaving ? ' disabled' : ''}>Unmute</button></li>`).join('') || '<li>No muted categories.</li>';
      if (el('mute-add')) el('mute-add').disabled = prefsSaving || revision === null;
    }
    function clear(message = '') {
      epoch++; feedSequence++; prefsSequence++; openSequence++;
      items = []; cursor = null; loading = false; reading.clear(); revision = null; muted = []; draft = []; dirty = false; conflict = false; prefsLoading = false; prefsSaving = false; status = message; prefsStatus = '';
      syncBadge();
      render();
    }
    function setAccount(next) {
      const value = String(next || '');
      if (value === actor) return;
      actor = value; projects = []; blocked = new Set(); filters = { projectId: '', category: '', unread: '' }; clear(); renderProjectOptions();
    }
    function renderProjectOptions() {
      if (el('project')) { el('project').innerHTML = options(true); el('project').value = filters.projectId; }
      if (el('mute-project')) el('mute-project').innerHTML = options(false);
    }
    function setProjects(next = [], deniedIds = []) {
      const nextIds = new Set(next.map((p) => p.id));
      const lost = projects.some((p) => !nextIds.has(p.id));
      const denied = deniedIds.some((id) => !blocked.has(id));
      blocked = new Set(deniedIds);
      projects = next.filter((p) => !blocked.has(p.id));
      if (lost || denied) clear('Project access changed. Refresh updates.');
      if (filters.projectId && !projects.some((p) => p.id === filters.projectId)) filters.projectId = '';
      renderProjectOptions(); render();
    }
    function deny(projectId) {
      if (projectId) { blocked.add(projectId); projects = projects.filter((p) => p.id !== projectId); }
      clear('Project access changed. Refresh updates.'); renderProjectOptions();
      deps.onAccessDenied?.(projectId);
    }
    function failed(error, s, projectId, preferences = false) {
      if (!current(s)) return;
      if ([401, 403, 404].includes(error?.status)) { deny(projectId); return; }
      if (preferences) prefsStatus = 'Preferences could not be saved or loaded. Your draft is retained. Retry.';
      else status = 'Updates could not be loaded or changed. Retry.';
      render();
    }
    async function refresh(append = false) {
      if (!actor || actor !== uid() || !api || (append && (!cursor || loading))) return;
      const s = scope(), sequence = ++feedSequence;
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v !== '') query.set(k, v); });
      if (append) query.set('cursor', cursor);
      else { items = []; cursor = null; }
      loading = true; status = 'Loading updates…'; render();
      try {
        const result = await api(`/api/projects/notifications?${query}`);
        if (!current(s) || sequence !== feedSequence) return;
        const page = (result.items || []).filter((item) => !blocked.has(item.projectId)).map((item) => ({ notificationId: item.notificationId, projectId: item.projectId, category: item.category, createdAt: item.createdAt, read: !!item.read, available: !!item.available, ...(item.available ? { message: item.message, taskLabel: item.taskLabel } : {}) }));
        items = [...new Map((append ? items.concat(page) : page).map((item) => [item.notificationId, item])).values()];
        cursor = result.hasMore ? result.nextCursor : null; status = `${items.length} updates loaded.`;
      } catch (error) { if (sequence === feedSequence) failed(error, s, filters.projectId); }
      finally { if (current(s) && sequence === feedSequence) { loading = false; render(); } }
    }
    async function setFilters(next) {
      filters = { projectId: String(next.projectId || ''), category: categories.includes(next.category) ? next.category : '', unread: ['true', 'false'].includes(next.unread) ? next.unread : '' };
      openSequence++; return refresh();
    }
    async function setRead(id, read) {
      const item = items.find((entry) => entry.notificationId === id);
      if (!item || reading.has(id) || actor !== uid()) return;
      const s = scope(); reading.add(id); render();
      // A prior feed response must not overwrite the acknowledged read mutation.
      feedSequence++; loading = false;
      try {
        await api(`/api/projects/notifications/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: !!read }) });
        if (!current(s)) return;
        feedSequence++; loading = false;
        items = items.map((entry) => entry.notificationId === id ? { ...entry, read: !!read } : entry).filter((entry) => !filters.unread || entry.read !== (filters.unread === 'true'));
        status = `Update marked ${read ? 'read' : 'unread'}.`;
      } catch (error) { failed(error, s, item.projectId); }
      finally { if (current(s)) { reading.delete(id); render(); } }
    }
    async function open(id) {
      const item = items.find((entry) => entry.notificationId === id);
      if (!item?.available || actor !== uid()) return;
      const s = scope(), sequence = ++openSequence;
      const navigation = deps.getNavigationGeneration?.();
      const valid = () => current(s) && sequence === openSequence && !blocked.has(item.projectId);
      status = 'Checking access…'; render();
      try {
        const target = await api(`/api/projects/notifications/${encodeURIComponent(id)}/target`);
        if (!valid() || navigation !== deps.getNavigationGeneration?.()) return;
        if (!target.available) {
          items = items.map((entry) => entry.notificationId === id ? { notificationId: id, projectId: item.projectId, category: item.category, createdAt: item.createdAt, read: item.read, available: false } : entry);
          status = 'This update is no longer available.'; render(); return;
        }
        if (target.projectId !== item.projectId || !target.taskId) throw new Error('Invalid target');
        await deps.openTarget?.({ projectId: target.projectId, taskId: target.taskId, ...(target.messageId ? { messageId: target.messageId } : {}) }, valid);
        if (valid()) { status = 'Opened project update.'; render(); }
      } catch (error) { if (valid()) failed(error, s, item.projectId); }
    }
    async function loadPreferences() {
      if (!actor || actor !== uid() || prefsSaving) return;
      const s = scope(), sequence = ++prefsSequence;
      prefsLoading = true; prefsStatus = 'Loading preferences…'; render();
      try {
        const result = await api('/api/projects/notification-preferences');
        if (!current(s) || sequence !== prefsSequence) return;
        revision = result.revision; muted = copy(result.muted || []);
        if (!dirty) draft = copy(muted);
        conflict = false; prefsStatus = dirty ? 'Current revision loaded. Review your retained draft and save.' : 'Mute stops future updates; existing history remains.';
      } catch (error) { failed(error, s, '', true); }
      finally { if (current(s) && sequence === prefsSequence) { prefsLoading = false; render(); } }
    }
    function setMute(projectId, category, value) {
      if (prefsSaving || !categories.includes(category) || !projects.some((p) => p.id === projectId)) return;
      draft = draft.filter((entry) => !(entry.projectId === projectId && entry.category === category));
      if (value) draft.push({ projectId, category });
      dirty = true; render();
    }
    async function savePreferences() {
      if (!dirty || revision === null || prefsSaving || prefsLoading || conflict || actor !== uid()) return;
      const s = scope(), replacement = copy(draft);
      prefsSaving = true; prefsStatus = 'Saving preferences…'; render();
      try {
        const result = await api('/api/projects/notification-preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision, muted: replacement }) });
        if (!current(s)) return;
        revision = result.revision; muted = copy(result.muted || replacement); draft = copy(muted); dirty = false; prefsStatus = 'Preferences saved.';
      } catch (error) {
        if (current(s) && error?.status === 409) { conflict = true; prefsStatus = 'Preferences changed elsewhere. Refresh preferences, review your retained draft, then save.'; }
        else failed(error, s, '', true);
      } finally { if (current(s)) { prefsSaving = false; render(); } }
    }
    function init() {
      if (!root) return;
      const categoryOptions = categories.map((c) => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join('');
      root.innerHTML = `<details data-notifications-panel><summary>Project notifications</summary><div class="crm-inline-fields crm-projects-notification-filters"><label>Project<select class="crm-input" data-notifications-project></select></label><label>Category<select class="crm-input" data-notifications-category><option value="">All categories</option>${categoryOptions}</select></label><label>Read state<select class="crm-input" data-notifications-unread><option value="">All updates</option><option value="true">Unread</option><option value="false">Read</option></select></label><button type="button" class="crm-btn-secondary" data-notifications-refresh>Refresh / retry</button></div><p data-notifications-status role="status"></p><ul data-notifications-list class="crm-projects-notification-list"></ul><button type="button" class="crm-btn-secondary" data-notifications-more hidden>Load more</button><details><summary>Notification preferences</summary><p data-notifications-prefs-status role="status"></p><div class="crm-inline-fields"><label>Project<select class="crm-input" data-notifications-mute-project></select></label><label>Category<select class="crm-input" data-notifications-mute-category>${categoryOptions}</select></label><button type="button" class="crm-btn-secondary" data-notifications-mute-add>Mute category</button></div><ul data-notifications-mute-list></ul><div class="crm-inline-fields"><button type="button" class="crm-btn-primary" data-notifications-save>Save preferences</button><button type="button" class="crm-btn-secondary" data-notifications-prefs-refresh>Refresh preferences</button></div></details></details>`;
      el('panel').addEventListener('toggle', () => { if (el('panel').open) { refresh(); loadPreferences(); } });
      root.addEventListener('change', (event) => { if (['project', 'category', 'unread'].some((name) => event.target === el(name))) setFilters({ projectId: el('project').value, category: el('category').value, unread: el('unread').value }); });
      root.addEventListener('click', (event) => {
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        if (button === el('refresh')) refresh();
        else if (button === el('more')) refresh(true);
        else if (button === el('prefs-refresh')) loadPreferences();
        else if (button === el('save')) savePreferences();
        else if (button === el('mute-add')) setMute(el('mute-project').value, el('mute-category').value, true);
        else if (button.dataset.notificationOpen) open(button.dataset.notificationOpen);
        else if (button.dataset.notificationRead) { const item = items.find((entry) => entry.notificationId === button.dataset.notificationRead); if (item) setRead(item.notificationId, !item.read); }
        else if (button.dataset.notificationUnmute !== undefined) { const entry = draft[Number(button.dataset.notificationUnmute)]; if (entry) setMute(entry.projectId, entry.category, false); }
      });
      renderProjectOptions(); render();
    }
    return { init, setAccount, setProjects, deny, refresh, setFilters, setRead, open, loadPreferences, setMute, savePreferences, getState: () => copy({ actor, items, cursor, loading, status, filters, revision, muted, draft, dirty, conflict, prefsLoading, prefsSaving, prefsStatus }) };
  }
  globalScope.CrmProjectsNotifications = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
