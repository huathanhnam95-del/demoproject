(function (root) {
    'use strict';
    const PALETTE = ['#B71C50', '#E67C73', '#D50000', '#F4511E', '#EF6C00', '#F09300', '#F6BF26', '#E4C441', '#C0CA33', '#7CB342', '#0B8043', '#009688', '#039BE5', '#3F51B5', '#7986CB', '#B39DDB', '#8E24AA', '#616161', '#A79B8E', '#D2E3FC', '#CEEAD6', '#E8DEF8', '#FAD2CF', '#FEEFC3'];
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function create(options) {
        const { button, panel } = options;
        if (!button || !panel) return null;
        let context = null;
        let pending = false;
        let selected;
        let generation = 0;
        const ink = (color) => root.TeacherSchedulerPresentation.customTheme(color)?.title || '#202124';
        const swatch = (color) => `<span class="ts-color-dot" style="background:${color}" aria-hidden="true"></span>`;

        function close(restoreFocus = false) {
            generation += 1;
            context = null;
            pending = false;
            panel.removeAttribute('aria-busy');
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            if (restoreFocus) button.focus();
        }
        function sync() {
            const current = options.getContext();
            if (context && (!current || context.key !== current.key)) close();
            if (current) {
                const label = button.querySelector('#teacher-scheduler-color-label');
                if (label) label.textContent = current.tags.tags?.[current.color] || 'Colour';
            }
        }
        function open() {
            close();
            context = options.getContext();
            if (!context) return;
            selected = undefined;
            panel.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            render();
            panel.querySelector('button')?.focus();
        }
        function render() {
            if (!context) return;
            const tags = context.tags.tags || {};
            const color = context.color;
            const isScope = selected !== undefined;
            panel.innerHTML = isScope ? `
                <div class="ts-color-preview">${selected ? swatch(selected) : ''}<strong>${esc(selected ? tags[selected] || selected : 'Default teacher colour')}</strong></div>
                <fieldset class="ts-color-scopes"><legend>Apply colour to</legend>
                    <label><input type="radio" name="ts-color-scope" value="session" checked><span>This session only</span></label>
                    <label><input type="radio" name="ts-color-scope" value="all"><span>All sessions of this class<small>Past and future, including sessions added later</small></span></label>
                    <label><input type="radio" name="ts-color-scope" value="following"><span>This and following sessions<small>From ${esc(context.dateLabel)} onward</small></span></label>
                </fieldset>
                <p class="ts-color-hint">${esc(context.className)} · Visible to all schedule viewers.</p>
                <div class="ts-color-actions"><button type="button" data-action="back">Back</button><button type="button" class="ts-color-primary" data-action="apply">Apply colour</button></div>` : `
                <p class="ts-color-hint">Shared colours and tags</p>
                <div class="ts-color-tags">${Object.entries(tags).map(([hex, label]) => `<button type="button" data-color="${esc(hex)}" aria-pressed="${hex === color}">${swatch(hex)}${esc(label)}</button>`).join('')}</div>
                <div class="ts-color-swatches" aria-label="Session colours">${PALETTE.map((hex) => `<button type="button" data-color="${hex}" aria-label="${esc(tags[hex] || hex)}" aria-pressed="${hex === color}" style="--swatch:${hex};--swatch-ink:${ink(hex)}"><span aria-hidden="true">${hex === color ? '✓' : ''}</span></button>`).join('')}</div>
                <button type="button" data-action="default" class="ts-color-default">Default teacher colour</button>
                <details class="ts-color-custom"><summary>Custom colour &amp; tag names</summary>
                    <label>Saved / palette colour<select data-field="preset">${[...new Set([...Object.keys(tags), ...PALETTE])].map((hex) => `<option value="${esc(hex)}" ${hex === (color || PALETTE[0]) ? 'selected' : ''}>${esc(tags[hex] || hex)}</option>`).join('')}</select></label>
                    <label>Colour<input type="color" data-field="color" value="${esc(color || PALETTE[0])}"></label>
                    <button type="button" data-action="custom">Use this colour</button>
                    <label>Shared tag name<input type="text" data-field="label" maxlength="40" placeholder="e.g. Paid" value="${esc(tags[color || PALETTE[0]] || '')}"></label>
                    <p class="ts-color-hint">Clear the name to remove its tag. Tags do not change attendance or payments.</p>
                    <button type="button" data-action="tag">Save tag name</button>
                </details>`;
            panel.insertAdjacentHTML('beforeend', '<p class="ts-color-error" role="alert" hidden></p><button type="button" data-action="refresh" hidden>Refresh colours</button>');
            options.reposition?.();
        }
        async function save(kind) {
            if (pending || !context) return;
            const captured = context;
            const token = generation;
            const scope = panel.querySelector('input[name="ts-color-scope"]:checked')?.value;
            const payload = kind === 'color'
                ? { color: selected, scope, expectedRevision: captured.plan.revision || 0 }
                : { color: panel.querySelector('[data-field="color"]').value.toUpperCase(), label: panel.querySelector('[data-field="label"]').value, expectedRevision: captured.tags.revision || 0 };
            pending = true;
            panel.setAttribute('aria-busy', 'true');
            panel.querySelectorAll('button, input, select').forEach((el) => { el.disabled = true; });
            try {
                await options.save(kind, captured, payload);
                if (token !== generation) return;
                if (kind === 'color') close(true);
                else {
                    context = options.getContext();
                    if (!context || context.key !== captured.key) { close(); return; }
                    render();
                    const message = panel.querySelector('.ts-color-error');
                    message.textContent = 'Shared tag saved.';
                    message.hidden = false;
                }
            } catch (error) {
                if (token !== generation) return;
                const message = panel.querySelector('.ts-color-error');
                message.textContent = error?.message || 'Could not save. Please try again.';
                message.hidden = false;
                panel.querySelector('[data-action="refresh"]').hidden = false;
            } finally {
                if (token === generation) {
                    pending = false;
                    panel.removeAttribute('aria-busy');
                    panel.querySelectorAll('button, input, select').forEach((el) => { el.disabled = false; });
                    options.reposition?.();
                }
            }
        }
        button.addEventListener('click', () => panel.hidden ? open() : close(true));
        panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        });
        panel.addEventListener('change', (event) => {
            if (event.target.matches('[data-field="preset"]')) {
                panel.querySelector('[data-field="color"]').value = event.target.value;
                panel.querySelector('[data-field="label"]').value = context?.tags.tags?.[event.target.value] || '';
            } else if (event.target.matches('[data-field="color"]')) {
                panel.querySelector('[data-field="label"]').value = context?.tags.tags?.[event.target.value.toUpperCase()] || '';
            }
        });
        panel.addEventListener('toggle', () => options.reposition?.(), true);
        panel.addEventListener('click', async (event) => {
            // Rendering scope choices detaches the clicked swatch. Keep that click inside
            // the popover instead of letting the workspace misread it as an outside click.
            event.stopPropagation();
            const target = event.target.closest('button');
            if (!target || pending) return;
            const action = target.dataset.action;
            if (target.dataset.color || action === 'custom' || action === 'default') {
                selected = action === 'default' ? null : target.dataset.color || panel.querySelector('[data-field="color"]').value.toUpperCase();
                render();
                panel.querySelector('input')?.focus();
            } else if (action === 'back') { selected = undefined; render(); }
            else if (action === 'apply') await save('color');
            else if (action === 'tag') await save('tag');
            else if (action === 'refresh') {
                const token = generation;
                pending = true;
                target.disabled = true;
                try { await options.refresh(); if (token === generation) open(); }
                catch (error) {
                    if (token === generation) panel.querySelector('.ts-color-error').textContent = error?.message || 'Could not refresh. Try again.';
                } finally {
                    if (token === generation) { pending = false; target.disabled = false; }
                }
            }
        });
        return { open, close, sync };
    }
    root.TeacherSchedulerColors = { create, PALETTE };
})(typeof window !== 'undefined' ? window : globalThis);
