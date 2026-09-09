(function (globalScope) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const palette = ['#3b82f6', '#8b5cf6', '#16815d', '#d97706'];

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
            const railMarkup = projects.length ? projects.map((project, index) => `<button type="button" data-workspace-project="${escape(project.id)}" aria-current="${String(project.id) === String(selected?.id) ? 'page' : 'false'}"><span class="crm-projects-rail-dot" style="--crm-project-group-color:${palette[index % palette.length]}" aria-hidden="true"></span><span>${escape(project.name || project.title || 'Untitled project')}</span></button>`).join('') : '<p class="crm-projects-rail-empty">Your projects will appear here.</p>';
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
                const opener = event.target.closest?.('[data-projects-open]');
                if (!opener || !current()) return;
                const dialog = byId(opener.dataset.projectsOpen);
                if (dialog?.matches('[data-projects-dialog]')) { activateSettings(opener.dataset.projectsSettingsTab || 'project'); dialog.hidden = false; if (!dialog.open) dialog.showModal(); }
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
            if (utilityRail) {
                listen(utilityRail, 'click', event => {
                    const tab = event.target.closest?.('[data-u]');
                    if (tab) {
                        utilityRail.classList.remove('collapsed');
                        const ucollapse = byId('ucollapse');
                        if (ucollapse) { ucollapse.textContent = '»'; ucollapse.setAttribute('aria-label', 'Collapse utilities'); }
                        utilityRail.querySelectorAll?.('[data-u]')?.forEach?.(b => b.setAttribute('aria-selected', String(b === tab)));
                        utilityRail.querySelectorAll?.('.upane')?.forEach?.(p => p.classList.toggle('on', p.dataset.p === tab.dataset.u));
                        return;
                    }
                    const collapseBtn = event.target.closest?.('#ucollapse');
                    if (collapseBtn) {
                        const collapsed = utilityRail.classList.toggle('collapsed');
                        collapseBtn.textContent = collapsed ? '«' : '»';
                        collapseBtn.setAttribute('aria-label', collapsed ? 'Expand utilities' : 'Collapse utilities');
                    }
                });
            }
            listen(byId('btn-projects-automate'), 'click', () => {
                const rail = byId('projects-utility-rail');
                if (!rail) return;
                rail.classList.remove('collapsed');
                const ucollapse = byId('ucollapse');
                if (ucollapse) { ucollapse.textContent = '»'; ucollapse.setAttribute('aria-label', 'Collapse utilities'); }
                rail.querySelectorAll?.('[data-u]')?.forEach?.(b => b.setAttribute('aria-selected', String(b.dataset.u === 'automations')));
                rail.querySelectorAll?.('.upane')?.forEach?.(p => p.classList.toggle('on', p.dataset.p === 'automations'));
            });
            for (const id of ['projects-automations']) {
                const target = byId(id);
                if (target && globalScope.MutationObserver) {
                    const observer = new globalScope.MutationObserver(() => {
                        if (!target.hidden) {
                            const utility = target.closest('details');
                            if (utility) utility.open = true;
                            const rail = byId('projects-utility-rail');
                            if (rail) {
                                rail.classList.remove('collapsed');
                                const ucollapse = byId('ucollapse');
                                if (ucollapse) { ucollapse.textContent = '»'; ucollapse.setAttribute('aria-label', 'Collapse utilities'); }
                                rail.querySelectorAll?.('[data-u]')?.forEach?.(b => b.setAttribute('aria-selected', String(b.dataset.u === 'automations')));
                                rail.querySelectorAll?.('.upane')?.forEach?.(p => p.classList.toggle('on', p.dataset.p === 'automations'));
                            }
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
