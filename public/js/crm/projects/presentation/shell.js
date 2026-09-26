(function (globalScope) {
    'use strict';
    const labels = { assistant: 'Assistance', notifications: 'Inbox', automations: 'Automations', recovery: 'Archive & trash' };
    function createController(deps = {}) {
        const doc = deps.document || globalScope.document, panel = deps.panel;
        const uid = String(deps.getCurrentUser?.()?.uid || '');
        const byId = id => doc?.getElementById(id);
        const current = () => !disposed && uid && uid === String(deps.getCurrentUser?.()?.uid || '');
        let initialized = false, disposed = false, selectedProjectId = '', selectedProjectName = '', menuDialog = '', page, nav, tableButton, utilityTitle, resizeObserver;
        const VIEW_SHORTCUTS = [['board', 'Table'], ['kanban', 'Kanban'], ['gantt', 'Gantt'], ['calendar', 'Calendar'], ['charts', 'Charts']];
        function renderBackName() {
            const target = tableButton?.querySelector('[data-back-name]');
            if (target) target.textContent = selectedProjectName || 'project';
            if (tableButton) tableButton.disabled = !selectedProjectId;
        }
        const restore = [], removers = [];
        function listen(node, type, handler) { node?.addEventListener(type, handler); removers.push(() => node?.removeEventListener(type, handler)); }
        function move(node, target) {
            if (!node || !target) return;
            const placeholder = doc.createComment('projects-v2-original-slot'); node.before(placeholder); target.append(node);
            restore.push(() => { placeholder.replaceWith(node); });
        }
        function attribute(node, key, value) {
            if (!node) return;
            const previous = node.getAttribute(key);
            restore.push(() => { if (previous === null) node.removeAttribute(key); else node.setAttribute(key, previous); });
            if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
        }
        function closeMenu(focus = false) {
            const details = panel?.querySelector('.crm-projects-view-options');
            if (!details?.open) return;
            details.open = false;
            if (focus) details.querySelector('summary')?.focus();
        }
        function navigate(destination = 'table', focus = false, keepSidebar = false) {
            if (!current() || !page || (destination !== 'table' && !labels[destination])) return;
            const utility = destination !== 'table';
            byId('projects-board-section').hidden = utility;
            page.hidden = !utility;
            nav.querySelectorAll('[data-u]').forEach(button => { const active = utility && button.dataset.u === destination; button.setAttribute('aria-selected', String(active)); button.tabIndex = active || (!utility && button.dataset.u === 'assistant') ? 0 : -1; });
            page.querySelectorAll('[data-p]').forEach(pane => { pane.hidden = pane.dataset.p !== destination; pane.classList.toggle('on', !pane.hidden); });
            tableButton.setAttribute('aria-current', utility ? 'false' : 'page');
            if (utilityTitle) utilityTitle.textContent = utility ? labels[destination] : '';
            panel.dataset.projectsUtility = utility ? destination : '';
            if (utility) {
                const pane = byId(`projects-upane-${destination}`);
                // Keep disclosure ownership: its existing toggle listener loads data.
                const disclosure = pane?.querySelector('details');
                if (disclosure) disclosure.open = true;
                if (focus) pane?.focus();
            }
            if (!keepSidebar) {
                byId('projects-workspace-rail')?.classList.remove('is-open');
                byId('projects-workspace-rail-toggle')?.setAttribute('aria-expanded', 'false');
            }
        }
        function activateTab(tab, keyboardTraversal = false) {
            navigate(tab.dataset.u, !keyboardTraversal, keyboardTraversal);
            if (keyboardTraversal) tab.focus();
            if (tab.dataset.u === 'automations') deps.openAutomations?.();
        }
        return {
            init() {
                if (initialized || !panel || !current()) return;
                initialized = true;
                const main = byId('projects-workspace-main'), rail = byId('projects-utility-rail');
                nav = rail?.querySelector('.crm-projects-utility-tabs');
                if (!main || !nav) return;
                const boardSection = byId('projects-board-section');
                attribute(boardSection, 'hidden', boardSection?.getAttribute('hidden'));
                page = doc.createElement('section'); page.id = 'projects-utility-page'; page.hidden = true; page.setAttribute('aria-label', 'Project utilities'); main.append(page);
                // Side tabs (Inbox, Archive...) keep a clear way back: a named
                // back button, the page title and the project's view tabs.
                const header = doc.createElement('div'); header.className = 'crm-projects-utility-header';
                tableButton = doc.createElement('button'); tableButton.id = 'projects-v2-table'; tableButton.type = 'button'; tableButton.className = 'crm-projects-back'; tableButton.setAttribute('aria-controls', 'projects-board-section');
                tableButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"/></svg><span>Back to <strong data-back-name></strong></span>';
                utilityTitle = doc.createElement('h2'); utilityTitle.className = 'crm-projects-utility-title';
                const shortcuts = doc.createElement('nav'); shortcuts.className = 'crm-projects-utility-viewtabs'; shortcuts.setAttribute('aria-label', 'Open this project in');
                shortcuts.innerHTML = VIEW_SHORTCUTS.map(([view, label]) => `<button type="button" data-open-view="${view}">${label}</button>`).join('');
                header.append(tableButton, utilityTitle, shortcuts); page.append(header); renderBackName();
                listen(shortcuts, 'click', event => {
                    const view = event.target.closest('[data-open-view]')?.dataset.openView; if (!view || !current()) return;
                    navigate('table');
                    byId('projects-view-tabs')?.querySelector(`[data-view="${view}"]`)?.click();
                });
                move(nav, byId('projects-workspace-rail'));
                attribute(rail, 'hidden', ''); attribute(byId('ucollapse'), 'hidden', '');
                rail.querySelectorAll('[data-p]').forEach(pane => { attribute(pane, 'hidden', ''); attribute(pane, 'class', pane.className); move(pane, page); });
                nav.querySelectorAll('[data-u]').forEach(button => {
                    attribute(button, 'aria-selected', 'false'); attribute(button, 'tabindex', '-1');
                    const label = doc.createElement('span'); label.textContent = labels[button.dataset.u]; button.append(label); restore.push(() => label.remove());
                });
                const boardTab = byId('projects-view-tabs')?.querySelector('[data-view="board"]');
                if (boardTab) { const label = boardTab.textContent; boardTab.textContent = 'Table'; restore.push(() => { boardTab.textContent = label; }); }
                listen(tableButton, 'click', () => navigate('table'));
                listen(nav, 'click', event => {
                    const tab = event.target.closest('[data-u]'); if (!tab || !current()) return;
                    activateTab(tab);
                });
                listen(nav, 'keydown', event => {
                    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                    const tabs = [...nav.querySelectorAll('[data-u]')], index = tabs.indexOf(event.target.closest('[data-u]'));
                    if (index < 0 || !current()) return;
                    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
                    activateTab(tabs[next], true);
                });
                // The existing automation controller handles activation; only navigate here.
                listen(byId('btn-projects-automate'), 'click', () => navigate('automations'));
                listen(byId('projects-automations'), 'click', event => {
                    if (!event.target.closest('[data-auto-action="close"]') || !current()) return;
                    navigate('table'); byId('btn-projects-automate')?.focus();
                });
                const details = panel.querySelector('.crm-projects-view-options');
                const summary = details?.querySelector('summary'), menu = details?.querySelector('.crm-projects-view-options-popover');
                const summaryLabel = summary?.querySelector('span');
                if (summaryLabel) { const original = summaryLabel.textContent; summaryLabel.textContent = 'Project menu'; restore.push(() => { summaryLabel.textContent = original; }); }
                attribute(summary, 'aria-label', 'Project menu'); attribute(summary, 'title', 'Project menu');
                const actions = panel.querySelector('.crm-projects-workspace-heading-actions');
                const members = doc.createElement('button'); members.id = 'projects-v2-members'; members.type = 'button'; members.className = 'crm-btn-secondary'; members.textContent = 'Members'; members.dataset.projectsOpen = 'projects-workspace-settings'; members.dataset.projectsSettingsTab = 'members'; members.disabled = !selectedProjectId;
                actions?.prepend(members); restore.push(() => members.remove());
                move(actions?.querySelector('button[data-projects-open="projects-workspace-settings"]:not(#projects-v2-members)'), menu);
                move(byId('btn-projects-board-refresh'), menu); move(byId('btn-projects-access-refresh'), menu);
                // Two "Refresh" entries read as duplicates; name what each one reloads.
                const accessRefresh = byId('btn-projects-access-refresh');
                if (accessRefresh) { const original = accessRefresh.textContent; accessRefresh.textContent = 'Refresh project list'; restore.push(() => { accessRefresh.textContent = original; }); }
                const schema = byId('btn-projects-board-add-column');
                if (schema) { const original = schema.textContent; schema.textContent = 'Add column (Owner)'; restore.push(() => { schema.textContent = original; }); move(schema, menu); }
                const recovery = doc.createElement('button'); recovery.type = 'button'; recovery.className = 'crm-btn-secondary'; recovery.textContent = 'Archive & trash'; menu?.append(recovery); restore.push(() => recovery.remove());
                listen(recovery, 'click', () => { closeMenu(); navigate('recovery', true); });
                listen(menu, 'click', event => {
                    const button = event.target.closest('button');
                    menuDialog = button?.dataset.projectsOpen || (button?.id === 'btn-projects-board-add-column' ? 'projects-board-column-form' : '');
                    if (button && !['btn-projects-density', 'btn-projects-theme'].includes(button.id)) closeMenu(true);
                });
                for (const id of ['projects-workspace-settings', 'projects-board-column-form']) listen(byId(id), 'close', () => {
                    if (menuDialog !== id) return;
                    menuDialog = '';
                    if (current()) summary?.focus();
                });
                listen(doc, 'pointerdown', event => { if (details?.open && !details.contains(event.target)) details.open = false; });
                listen(details, 'keydown', event => { if (event.key === 'Escape') { details.open = false; details.querySelector('summary')?.focus(); event.preventDefault(); } });
                // CSS owns layout. Observe only the discrete sidebar mode.
                let narrow;
                const syncWidth = () => {
                    const width = panel.getBoundingClientRect().width;
                    if (!width) return;
                    const next = width < 1100;
                    if (next === narrow) return;
                    narrow = next; panel.dataset.projectsNarrow = String(next);
                    byId('projects-workspace-rail')?.classList.remove('is-open');
                    byId('projects-workspace-rail-toggle')?.setAttribute('aria-expanded', 'false');
                };
                if (globalScope.ResizeObserver) { resizeObserver = new globalScope.ResizeObserver(syncWidth); resizeObserver.observe(panel); }
                syncWidth(); navigate();
            },
            navigate,
            setSelection(selection) {
                const id = String(selection?.selectedProjectId || '');
                const chosen = selection?.selectedProject || (selection?.projects || []).find(project => String(project.id) === id);
                selectedProjectName = String(chosen?.name || chosen?.title || '');
                if (byId('projects-v2-members')) byId('projects-v2-members').disabled = !id;
                if (id !== selectedProjectId) { selectedProjectId = id; menuDialog = ''; closeMenu(); navigate(); }
                renderBackName();
            },
            showBoard() { navigate('table'); },
            closeForNavigation() { navigate(); const details = panel?.querySelector('.crm-projects-view-options'); if (details) details.open = false; },
            dispose() {
                if (disposed) return;
                if (initialized) navigate(); disposed = true; resizeObserver?.disconnect(); removers.forEach(remove => remove());
                closeMenu(); restore.reverse().forEach(undo => undo()); page?.remove(); tableButton?.remove(); panel?.removeAttribute('data-projects-narrow'); panel?.removeAttribute('data-projects-view'); panel?.removeAttribute('data-projects-utility');
            }
        };
    }
    globalScope.CrmProjectsShellV2 = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
