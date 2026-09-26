(function (scope) {
    'use strict';
    function createController(deps) {
        const model = scope.CrmProjectsColumnsV2, e = deps.elements, doc = e.projectsBoardTable.ownerDocument;
        const actor = String(deps.getCurrentUser?.()?.uid || '');
        let storage, project = '', columns = [], prefs = {}, saved = {}, menu, drag, frame = null, disposed = false, signature = '';
        const removers = [], restores = [];
        const current = () => !disposed && actor && actor === String(deps.getCurrentUser?.()?.uid || '');
        const key = () => `crm:projects:v2:columns:1:${encodeURIComponent(actor)}:${encodeURIComponent(project)}`;
        try { storage = deps.storage !== undefined ? deps.storage : scope.localStorage; } catch (_) { /* memory only */ }
        function listen(node, name, callback) { node.addEventListener(name, callback); removers.push(() => node.removeEventListener(name, callback)); }
        function update(next, persist = true) {
            if (!current() || !project) return;
            const focusedKey = doc.activeElement?.closest('[data-column-key]')?.dataset.columnKey;
            if (focusedKey && next.hidden?.includes(focusedKey)) return;
            prefs = model.normalize(next, columns);
            // Width and visibility preferences do not take ownership of shared ordering.
            saved = { ...prefs, order: Array.isArray(next.order) ? next.order : [] };
            if (persist) { try { storage?.setItem(key(), JSON.stringify(saved)); } catch (_) { /* memory only */ } }
            signature = ''; deps.onChange();
        }
        function persistPreferences() { try { storage?.setItem(key(), JSON.stringify(saved)); } catch (_) { /* memory only */ } }
        function setWidth(columnKey, width, persist = true) {
            const next = { ...saved, widths: { ...prefs.widths, [columnKey]: width } };
            if (model.normalize(next, columns).widths[columnKey] === prefs.widths[columnKey]) return;
            update(next, persist);
        }
        function cancelFrame() { if (frame !== null) { (scope.cancelAnimationFrame || scope.clearTimeout)(frame); frame = null; } }
        function flushDrag() { if (drag && drag.project === project && current()) setWidth(drag.key, drag.nextWidth, false); }
        function renderMenu() {
            const next = JSON.stringify([project, prefs, columns.map(c => [c.id,c.label,c.type])]);
            if (next === signature || menu.contains(doc.activeElement)) return;
            signature = next; menu.replaceChildren();
            for (const c of model.descriptors(columns)) {
                const row = doc.createElement('label'), checkbox = doc.createElement('input'), name = doc.createElement('span'), width = doc.createElement('input');
                checkbox.type = 'checkbox'; checkbox.checked = !prefs.hidden.includes(c.key); checkbox.disabled = c.key === 'taskTitle'; checkbox.dataset.columnVisibility = c.key;
                name.textContent = c.label;
                width.type = 'number'; width.min = c.min; width.max = c.max; width.step = '1'; width.value = prefs.widths[c.key]; width.dataset.columnWidth = c.key; width.setAttribute('aria-label', `${c.label} width in pixels`);
                row.append(checkbox, name, width); menu.append(row);
            }
        }
        return {
            init() {
                const { projectsBoardTable: table, projectsBoardScroll: scroll, projectsBoardRows: rows, projectsBoardTableWrap: wrap } = e;
                const slot = doc.createComment('projects-v2-table-slot'); table.before(slot);
                scroll.replaceWith(rows); scroll.append(table); wrap.append(scroll);
                const attrs = ['tabindex', 'aria-label'].map(name => [name, scroll.getAttribute(name)]);
                scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Project task table');
                restores.push(() => { slot.replaceWith(table); rows.replaceWith(scroll); scroll.append(rows); attrs.forEach(([name,value]) => value === null ? scroll.removeAttribute(name) : scroll.setAttribute(name,value)); });
                const details = doc.createElement('details'), summary = doc.createElement('summary'); summary.textContent = 'Columns';
                details.id = 'projects-v2-columns'; summary.className = 'crm-btn-secondary'; summary.setAttribute('aria-label', 'Columns'); menu = doc.createElement('div'); menu.setAttribute('aria-label', 'Personal column visibility and widths'); details.append(summary, menu);
                doc.getElementById('projects-view-filters')?.append(details); restores.push(() => details.remove());
                listen(doc, 'pointerdown', event => { if (details.open && !details.contains(event.target)) details.open = false; });
                listen(details, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); details.open = false; summary.focus(); } });
                // Resize handles exist in the shared header and in each section's header row.
                const onSurfaces = (name, callback) => [e.projectsBoardHeader, e.projectsBoardRows].filter(Boolean).forEach(node => listen(node, name, callback));
                listen(menu, 'change', event => {
                    const target = event.target;
                    if (target.dataset.columnWidth) setWidth(target.dataset.columnWidth, Number(target.value));
                    if (target.dataset.columnVisibility) update({ ...saved, hidden: target.checked ? prefs.hidden.filter(k => k !== target.dataset.columnVisibility) : [...prefs.hidden, target.dataset.columnVisibility] });
                });
                onSurfaces('keydown', event => {
                    const handle = event.target.closest('[data-column-resize]'); if (!handle || !current()) return;
                    const columnKey = handle.dataset.columnResize;
                    if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
                    event.preventDefault(); event.stopPropagation();
                    if (!handle.dataset.startWidth) handle.dataset.startWidth = String(prefs.widths[columnKey]);
                    const value = event.key === 'Escape' ? Number(handle.dataset.startWidth) : prefs.widths[columnKey] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10);
                    setWidth(columnKey, value);
                });
                onSurfaces('focusout', event => { if (event.target.dataset.columnResize) delete event.target.dataset.startWidth; });
                onSurfaces('pointerdown', event => {
                    const handle = event.target.closest('[data-column-resize]'); if (!handle || event.button !== 0 || !current()) return;
                    event.preventDefault(); event.stopPropagation(); handle.focus();
                    cancelFrame();
                    drag = { key: handle.dataset.columnResize, x: event.clientX, width: prefs.widths[handle.dataset.columnResize], nextWidth: prefs.widths[handle.dataset.columnResize], project, pointer: event.pointerId, handle };
                    handle.setPointerCapture(event.pointerId);
                });
                onSurfaces('dragstart', event => { if (event.target.closest('[data-column-resize]')) { event.preventDefault(); event.stopImmediatePropagation(); } });
                onSurfaces('pointermove', event => {
                    if (!drag || drag.project !== project || event.pointerId !== drag.pointer) return;
                    drag.nextWidth = drag.width + event.clientX - drag.x;
                    if (frame === null) frame = (scope.requestAnimationFrame || scope.setTimeout)(() => { frame = null; flushDrag(); });
                });
                const end = event => {
                    if (!drag || event.pointerId !== drag.pointer) return;
                    cancelFrame(); const previous = drag;
                    if (previous.project === project && current()) {
                        previous.nextWidth = event.type === 'pointercancel' ? previous.width : Number.isFinite(event.clientX) ? previous.width + event.clientX - previous.x : previous.nextWidth;
                        flushDrag(); persistPreferences();
                    }
                    drag = null;
                    if (previous.handle.hasPointerCapture?.(previous.pointer)) previous.handle.releasePointerCapture(previous.pointer);
                };
                onSurfaces('pointerup', end); onSurfaces('pointercancel', end);
                if (scope.ResizeObserver) {
                    const observer = new scope.ResizeObserver(() => { if (current()) deps.onChange(); });
                    observer.observe(scroll); restores.push(() => observer.disconnect());
                }
            },
            resolve(nextColumns, nextProject) {
                columns = nextColumns;
                if (project !== String(nextProject || '')) {
                    cancelFrame(); project = String(nextProject || ''); saved = {}; drag = null;
                    try { const stored = JSON.parse(storage?.getItem(key()) || 'null'); if (stored?.version === 1) saved = stored; } catch (_) { /* invalid record */ }
                }
                prefs = model.normalize(saved, columns); renderMenu(); return model.resolve(columns, prefs);
            },
            getPreferences: () => JSON.parse(JSON.stringify(prefs)),
            update,
            dispose() { if (disposed) return; cancelFrame(); disposed = true; drag = null; removers.forEach(remove => remove()); restores.reverse().forEach(restore => restore()); }
        };
    }
    scope.CrmProjectsTableLayoutV2 = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
