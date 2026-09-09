(function (globalScope) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const palette = ['#4f52d9', '#0d8478', '#2470c9', '#a86a12', '#b83a6e'];

    function createController(deps = {}) {
        const document = deps.document || globalScope.document;
        const actorUid = String(deps.getCurrentUser?.()?.uid || '');
        const byId = id => document?.getElementById(id);
        const panel = document?.querySelector('[data-panel="projects"]');
        const observers = [], removers = [];
        let selection = {}, context = null, timer = null, disposed = false, initialized = false;
        const current = () => !disposed && !!actorUid && String(deps.getCurrentUser?.()?.uid || '') === actorUid;
        function listen(node, event, handler) {
            if (!node) return;
            node.addEventListener(event, handler);
            removers.push(() => node.removeEventListener(event, handler));
        }
        function text(id, value) { const node = byId(id); if (node) node.textContent = value; }
        function render() {
            if (!current()) return;
            const projects = Array.isArray(selection.projects) ? selection.projects : [];
            const selected = projects.find(project => String(project.id) === String(selection.selectedProjectId)) || null;
            const loaded = context?.project && String(context.project.id) === String(selected?.id) ? context.project : selected;
            const summary = selection.accessSummary;
            const knownIdentity = summary?.identity?.uid === actorUid;
            const needsAccess = knownIdentity && summary.identity.moduleGrants?.projects !== true;
            const rail = byId('projects-workspace-projects');
            const focusedProject = rail?.contains(document.activeElement) ? document.activeElement?.closest?.('[data-workspace-project]')?.dataset.workspaceProject : null;
            const workspaceGroups = new Map();
            projects.forEach((project, index) => {
                const ws = project.workspace || 'Workspace';
                if (!workspaceGroups.has(ws)) workspaceGroups.set(ws, []);
                workspaceGroups.get(ws).push({ project, index });
            });
            const railMarkup = projects.length ? Array.from(workspaceGroups.entries()).map(([wsName, items]) => {
                const itemsHtml = items.map(({ project, index }) => `<button type="button" data-workspace-project="${escape(project.id)}" aria-current="${String(project.id) === String(selected?.id) ? 'page' : 'false'}"><span class="crm-projects-rail-dot" style="--crm-project-group-color:${palette[index % palette.length]}" aria-hidden="true"></span><span>${escape(project.name || project.title || 'Untitled project')}</span></button>`).join('');
                if (workspaceGroups.size === 1 && wsName === 'Workspace') return itemsHtml;
                return `<div class="crm-rail-workspace-group"><div class="crm-rail-workspace-heading"><span>${escape(wsName)}</span><span class="crm-rail-workspace-count">${items.length}</span></div>${itemsHtml}</div>`;
            }).join('') : '<p class="crm-projects-rail-empty">Your projects will appear here.</p>';
            if (rail && rail.innerHTML !== railMarkup) {
                rail.innerHTML = railMarkup;
                if (focusedProject) Array.from(rail.querySelectorAll('[data-workspace-project]')).find(button => button.dataset.workspaceProject === focusedProject)?.focus();
            }
            text('projects-workspace-name', loaded?.name || loaded?.title || selected?.name || selected?.title || 'Projects');
            text('projects-workspace-description', loaded?.description || (selected ? 'Keep tasks, updates and your team together.' : 'A shared space to plan work with your team.'));
            const onboarding = byId('projects-workspace-onboarding');
            if (onboarding) onboarding.hidden = !needsAccess;
            panel?.classList.toggle('crm-projects-access-needed', needsAccess);
            text('projects-workspace-onboarding-title', 'Set up your Projects access');
            text('projects-workspace-onboarding-message', summary?.canManagePeople ? 'Enable your Projects module access in People & Access, then return to create or join a project.' : 'Ask an administrator to enable Projects access and add you to the right project.');
            const manage = byId('projects-workspace-manage-access');
            if (manage) manage.hidden = !summary?.canManagePeople;
            for (const id of ['btn-projects-board-create-project', 'btn-projects-board-empty-create']) {
                const button = byId(id);
                if (button) button.hidden = needsAccess;
            }
        }
        function activateSettings(name = 'project') {
            const dialog = byId('projects-workspace-settings');
            dialog?.querySelectorAll('[data-projects-settings-tab]').forEach(button => {
                const active = button.dataset.projectsSettingsTab === name;
                button.setAttribute('aria-selected', String(active));
                button.tabIndex = active ? 0 : -1;
            });
            dialog?.querySelectorAll('[data-projects-settings-panel]').forEach(section => { section.hidden = section.dataset.projectsSettingsPanel !== name; });
        }
        function closeDialog(dialog, delegate = true) {
            const cancelIds = { 'projects-board-detail': 'btn-projects-board-close-detail', 'projects-board-create-project': 'btn-projects-board-cancel-project', 'projects-board-column-form': 'btn-projects-board-cancel-column' };
            const cancel = byId(cancelIds[dialog.id]);
            if (cancel?.disabled) return;
            if (delegate) cancel?.click();
            dialog.hidden = true;
            if (dialog.open) dialog.close();
        }
        function watchDialog(dialog) {
            const sync = () => {
                if (!current()) { if (dialog.open) dialog.close(); if (!dialog.hidden) dialog.hidden = true; return; }
                if (!dialog.hidden && !dialog.open) dialog.showModal();
                else if (dialog.hidden && dialog.open) dialog.close();
            };
            listen(dialog, 'cancel', event => { event.preventDefault(); closeDialog(dialog); });
            listen(dialog, 'close', () => { dialog.hidden = true; });
            listen(dialog, 'click', event => {
                const button = event.target.closest?.('[data-projects-close]');
                if (button && dialog.contains(button)) closeDialog(dialog, false);
            });
            if (globalScope.MutationObserver) {
                const observer = new globalScope.MutationObserver(sync);
                observer.observe(dialog, { attributes: true, attributeFilter: ['hidden'] });
                observers.push(observer);
            }
            sync();
        }
        function init() {
            if (initialized || !panel || !current()) return;
            initialized = true;
            listen(byId('projects-workspace-projects'), 'click', event => {
                const button = event.target.closest?.('[data-workspace-project]');
                if (!button || !current()) return;
                const id = button.dataset.workspaceProject;
                if (!(selection.projects || []).some(project => String(project.id) === id)) return;
                deps.selectProject?.(id);
                byId('projects-workspace-rail')?.classList.remove('is-open');
                byId('projects-workspace-rail-toggle')?.setAttribute('aria-expanded', 'false');
            });
            listen(byId('projects-workspace-rail-toggle'), 'click', () => {
                if (!current()) return;
                const open = byId('projects-workspace-rail')?.classList.toggle('is-open');
                byId('projects-workspace-rail-toggle')?.setAttribute('aria-expanded', String(open));
            });
            listen(byId('projects-workspace-manage-access'), 'click', () => { if (current() && selection.accessSummary?.canManagePeople) deps.onManageAccess?.(); });
            listen(panel, 'click', event => {
                const rail = byId('projects-workspace-rail');
                const toggle = byId('projects-workspace-rail-toggle');
                if (rail?.classList.contains('is-open') && !rail.contains(event.target) && !toggle?.contains(event.target)) {
                    rail.classList.remove('is-open');
                    toggle?.setAttribute('aria-expanded', 'false');
                }
                const opener = event.target.closest?.('[data-projects-open]');
                if (!opener || !current()) return;
                const dialog = byId(opener.dataset.projectsOpen);
                if (dialog?.matches('[data-projects-dialog]')) { activateSettings(opener.dataset.projectsSettingsTab || 'project'); dialog.hidden = false; if (!dialog.open) dialog.showModal(); }
            });
            listen(panel, 'keydown', event => {
                if (event.key === 'Escape') {
                    const rail = byId('projects-workspace-rail');
                    if (rail?.classList.contains('is-open')) {
                        rail.classList.remove('is-open');
                        byId('projects-workspace-rail-toggle')?.setAttribute('aria-expanded', 'false');
                        byId('projects-workspace-rail-toggle')?.focus?.();
                    }
                }
            });
            listen(byId('projects-workspace-settings'), 'click', event => {
                const tab = event.target.closest?.('[data-projects-settings-tab]');
                if (tab) activateSettings(tab.dataset.projectsSettingsTab);
            });
            listen(byId('projects-workspace-settings'), 'keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.matches?.('[data-projects-settings-tab]')) return;
                const tabs = Array.from(byId('projects-workspace-settings').querySelectorAll('[data-projects-settings-tab]'));
                const index = tabs.indexOf(event.target);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                event.preventDefault(); activateSettings(tabs[next].dataset.projectsSettingsTab); tabs[next].focus();
            });
            panel.querySelectorAll('[data-projects-dialog]').forEach(watchDialog);
            activateSettings();
            const filters = byId('projects-view-filters');
            listen(filters, 'input', event => {
                if (event.target.name !== 'title') return;
                clearTimeout(timer);
                timer = setTimeout(() => { if (current() && !event.target.disabled) filters.requestSubmit(); }, 250);
            });
            listen(filters, 'submit', () => {
                clearTimeout(timer);
                filters.querySelectorAll('details').forEach(details => { details.open = false; });
            });
            listen(filters, 'reset', () => { clearTimeout(timer); });
            const utilityRail = byId('projects-utility-rail');
            // Below 1700px the rail overlays the board instead of sharing the grid,
            // so it must start as the 49px icon strip or it covers the right-hand columns.
            const RAIL_INLINE_MIN_WIDTH = 1700;
            function syncRailDefault() {
                if (!utilityRail || utilityRail.dataset.userToggled === 'true') return;
                const overlays = (globalScope.innerWidth || 0) < RAIL_INLINE_MIN_WIDTH;
                utilityRail.classList.toggle('collapsed', overlays);
                const button = byId('ucollapse');
                if (button) {
                    button.textContent = overlays ? '«' : '»';
                    button.setAttribute('aria-label', overlays ? 'Expand utilities' : 'Collapse utilities');
                    button.setAttribute('aria-expanded', String(!overlays));
                }
            }
            function selectUtilityTab(tabName) {
                if (!utilityRail) return;
                utilityRail.classList.remove('collapsed');
                utilityRail.dataset.userToggled = 'true';
                const ucollapse = byId('ucollapse');
                if (ucollapse) {
                    ucollapse.textContent = '»';
                    ucollapse.setAttribute('aria-label', 'Collapse utilities');
                    ucollapse.setAttribute('aria-expanded', 'true');
                }
                utilityRail.querySelectorAll?.('[data-u]')?.forEach?.(b => {
                    const isSelected = b.dataset.u === tabName;
                    b.setAttribute('aria-selected', String(isSelected));
                    b.setAttribute('tabindex', isSelected ? '0' : '-1');
                });
                utilityRail.querySelectorAll?.('.crm-projects-utility-pane')?.forEach?.(p => p.classList.toggle('on', p.dataset.p === tabName));
            }
            syncRailDefault();
            if (typeof globalScope.addEventListener === 'function') listen(globalScope, 'resize', syncRailDefault);
            if (utilityRail) {
                listen(utilityRail, 'click', event => {
                    const tab = event.target.closest?.('[data-u]');
                    if (tab) {
                        selectUtilityTab(tab.dataset.u);
                        return;
                    }
                    const collapseBtn = event.target.closest?.('#ucollapse');
                    if (collapseBtn) {
                        const collapsed = utilityRail.classList.toggle('collapsed');
                        utilityRail.dataset.userToggled = 'true';
                        collapseBtn.textContent = collapsed ? '«' : '»';
                        collapseBtn.setAttribute('aria-label', collapsed ? 'Expand utilities' : 'Collapse utilities');
                        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
                    }
                });
                listen(utilityRail, 'keydown', event => {
                    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    const tab = event.target.closest?.('[data-u]');
                    if (!tab) return;
                    const tabs = Array.from(utilityRail.querySelectorAll('[data-u]'));
                    const index = tabs.indexOf(tab);
                    if (index < 0) return;
                    const isForward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (isForward ? 1 : -1) + tabs.length) % tabs.length;
                    event.preventDefault();
                    tabs[next].focus();
                    selectUtilityTab(tabs[next].dataset.u);
                });
            }
            listen(byId('btn-projects-automate'), 'click', () => {
                selectUtilityTab('automations');
            });
            for (const id of ['projects-automations']) {
                const target = byId(id);
                if (target && globalScope.MutationObserver) {
                    const observer = new globalScope.MutationObserver(() => {
                        if (!target.hidden) {
                            const utility = target.closest('details');
                            if (utility) utility.open = true;
                            selectUtilityTab('automations');
                        }
                    });
                    observer.observe(target, { attributes: true, attributeFilter: ['hidden'] });
                    observers.push(observer);
                }
            }
            render();
        }
        function dispose() {
            disposed = true; clearTimeout(timer); observers.forEach(observer => observer.disconnect()); removers.forEach(remove => remove());
            panel?.querySelectorAll('[data-projects-dialog]').forEach(dialog => { if (dialog.open) dialog.close(); dialog.hidden = true; });
        }
        return { init, dispose, closeForNavigation() { if (current()) panel?.querySelectorAll('[data-projects-dialog]').forEach(dialog => { if (dialog.open) closeDialog(dialog); }); }, setSelection(value) { selection = value || {}; render(); }, setContext(value) { context = value; render(); } };
    }
    globalScope.CrmProjectsWorkspace = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
