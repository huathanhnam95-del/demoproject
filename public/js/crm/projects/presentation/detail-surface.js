(function (globalScope) {
    'use strict';
    // Presentation only: the board remains the sole task/selection authority.
    const owners = new WeakMap();
    function createController(deps) {
        const dialog = deps.dialog, panel = deps.panel, document = dialog?.ownerDocument;
        const removers = [];
        let initialized = false, disposed = false, observer, taskId = '', compact = false, origin = null;
        let bodyHome, bodyNext, tabText, activeTab = 'details';
        const body = document?.getElementById('projects-board-detail-body');
        const overview = document?.getElementById('projects-detail-panel-details');
        const overviewTab = document?.getElementById('projects-detail-tab-details');
        const heading = document?.getElementById('projects-board-detail-title');
        function listen(node, type, handler) {
            node?.addEventListener(type, handler);
            removers.push(() => node?.removeEventListener(type, handler));
        }
        function activateTab(name) {
            if (!['details', 'updates'].includes(name)) return;
            activeTab = name;
            dialog.querySelectorAll('[data-detail-tab]').forEach(tab => {
                const active = tab.dataset.detailTab === name;
                tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
            });
            dialog.querySelectorAll('[data-detail-panel]').forEach(node => { node.hidden = node.dataset.detailPanel !== name; });
            deps.onTabActivated?.(name);
        }
        function focusHeading() { heading?.focus({ preventScroll: true }); }
        function restoreFocus(target) {
            if (!target) return;
            const { id, opener, scope } = target;
            const authorized = deps.canRestoreFocus?.(id, scope) !== false;
            if (authorized && opener?.isConnected && opener !== document.body && !opener.disabled && !dialog.contains(opener) && !opener.closest('[hidden]') && opener.checkVisibility?.({ visibilityProperty: true }) !== false) {
                opener.focus({ preventScroll: true });
                if (document.activeElement === opener) return;
            }
            deps.fallbackFocus?.(authorized ? id : '', scope);
        }
        function forceClose({ clear = false, restore = false } = {}) {
            const target = origin; taskId = ''; origin = null;
            if (dialog?.open) dialog.close();
            if (dialog) { dialog.hidden = true; dialog.removeAttribute('aria-modal'); }
            if (clear) {
                if (heading) heading.textContent = '';
                body?.replaceChildren();
                deps.onClear?.();
            }
            if (restore) restoreFocus(target);
        }
        function requestClose() {
            if (!taskId || disposed) return;
            // A draft/queue can outlive this surface. Async confirmation must
            // explicitly veto, then call forceClose after its own resolution.
            if (deps.beforeClose && deps.beforeClose() !== true) return;
            const target = origin;
            forceClose();
            deps.onClose?.();
            restoreFocus(target);
        }
        function mode() {
            dialog.dataset.detailMode = compact ? 'modal' : 'drawer';
            dialog.hidden = false;
            if (compact) { dialog.setAttribute('aria-modal', 'true'); dialog.showModal(); }
            else { dialog.removeAttribute('aria-modal'); dialog.show(); }
        }
        function resize() {
            if (disposed) return;
            const width = panel.getBoundingClientRect().width;
            if (!width) return;
            const next = width < 1000;
            if (compact === next) return;
            compact = next;
            if (!taskId || !dialog.open) return;
            const active = document.activeElement, scroll = dialog.scrollTop;
            const start = active?.selectionStart, end = active?.selectionEnd;
            dialog.dataset.detailTransition = 'true';
            dialog.close(); mode();
            if (dialog.contains(active) && active.isConnected) {
                active.focus({ preventScroll: true });
                if (typeof start === 'number') { try { active.setSelectionRange(start, end); } catch (_) { /* nontext input */ } }
            }
            dialog.scrollTop = scroll;
            delete dialog.dataset.detailTransition;
        }
        function init() {
            if (initialized || disposed || !dialog) return;
            if (owners.has(dialog)) throw new Error('Task details already have a presentation owner');
            initialized = true; owners.set(dialog, api);
            bodyHome = body?.parentNode; bodyNext = body?.nextSibling;
            if (body && overview) overview.prepend(body);
            tabText = overviewTab?.textContent;
            if (overviewTab) overviewTab.textContent = 'Overview';
            heading?.setAttribute('tabindex', '-1');
            compact = panel.getBoundingClientRect().width < 1000;
            listen(dialog, 'click', event => {
                if (event.target.closest?.('#btn-projects-board-close-detail')) { requestClose(); return; }
                const tab = event.target.closest?.('[data-detail-tab]');
                if (tab) activateTab(tab.dataset.detailTab);
                if (event.target === dialog && compact) {
                    const box = dialog.getBoundingClientRect();
                    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) requestClose();
                }
            });
            listen(dialog, 'cancel', event => { event.preventDefault(); requestClose(); });
            // A queued close from a mode transition must not hide the reopened node.
            listen(dialog, 'close', () => { if (!dialog.open && taskId) requestClose(); });
            listen(document, 'keydown', event => {
                if (!taskId || event.defaultPrevented) return;
                if (event.key === 'Escape') {
                    const topModal = Array.from(document.querySelectorAll('dialog[open]')).find(node => node !== dialog && node.matches?.(':modal'));
                    if (topModal) return;
                    event.preventDefault(); requestClose(); return;
                }
                if (!dialog.contains(event.target)) return;
                const tabs = Array.from(dialog.querySelectorAll('[data-detail-tab]'));
                if (tabs.includes(event.target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(event.target) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                    event.preventDefault(); activateTab(tabs[index].dataset.detailTab); tabs[index].focus();
                }
                if (compact && event.key === 'Tab') {
                    const stops = Array.from(dialog.querySelectorAll('button, input, select, textarea, summary, [tabindex], a[href], [contenteditable="true"]')).filter(node => !node.disabled && !node.closest('[hidden]') && node.tabIndex >= 0 && node.getClientRects().length && node.checkVisibility?.({ visibilityProperty: true }) !== false);
                    const first = stops[0], last = stops.at(-1);
                    if (!first) { event.preventDefault(); focusHeading(); }
                    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            });
            listen(globalScope, 'resize', resize);
            if (globalScope.ResizeObserver) { observer = new globalScope.ResizeObserver(resize); observer.observe(panel); }
        }
        function sync(task, request = {}) {
            if (disposed) return;
            if (!task) { forceClose({ clear: true, restore: request.restore === true }); return; }
            const changed = taskId !== String(task.id);
            // Internal hierarchy traversal keeps the session's logical origin even
            // when rendering has detached its opener or the focused child button.
            if (request.opener || !origin || (changed && !request.preserveOrigin && !dialog.contains(document.activeElement))) {
                origin = { id: String(task.id), opener: request.opener || document.activeElement, scope: deps.captureFocusScope?.() };
            }
            taskId = String(task.id);
            if (changed || request.tab) activateTab(request.tab || 'details');
            if (!dialog.open) { mode(); focusHeading(); }
        }
        function dispose() {
            if (disposed) return;
            forceClose({ clear: true }); disposed = true;
            observer?.disconnect(); removers.splice(0).forEach(remove => remove());
            if (initialized) {
                if (bodyHome && body) bodyHome.insertBefore(body, bodyNext?.parentNode === bodyHome ? bodyNext : null);
                if (overviewTab) overviewTab.textContent = tabText;
                heading?.removeAttribute('tabindex'); dialog.removeAttribute('data-detail-mode'); owners.delete(dialog);
            }
        }
        function replaceTaskId(previous, next) {
            if (taskId === String(previous)) taskId = String(next);
            if (origin?.id === String(previous)) origin.id = String(next);
        }
        const api = { init, sync, activeTab: () => activeTab, forceClose, requestClose, activateTab, replaceTaskId, dispose };
        return api;
    }
    globalScope.CrmProjectsDetailSurfaceV2 = { createController, hasOwner: dialog => owners.has(dialog), close: dialog => owners.get(dialog)?.requestClose() };
})(typeof window !== 'undefined' ? window : globalThis);
