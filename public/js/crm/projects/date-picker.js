/**
 * Projects date picker.
 *
 * Every date field in the Projects panel used to open Chrome's own calendar --
 * an OS widget that ignores the board's theme, its density and its tokens. This
 * replaces it with a popover built from the same tokens as the rest of the
 * panel, while leaving the native <input type="date"> in place as the value
 * store: it is still the element that holds, reports and validates the value,
 * so programmatic fills and every pinned selector behave exactly as before.
 *
 * The popover is position:fixed and appended to <body>, so it never changes the
 * height of the row or cell that owns the field.
 */
(function (globalScope) {
    'use strict';

    const SCOPE = '[data-panel="projects"]';
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    // Monday-first, matching the Vietnam working week the schedule service uses.
    const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    const WIDTH = 250;

    let popover = null;
    let field = null;
    let cursor = null;

    const pad = (n) => String(n).padStart(2, '0');
    const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const todayIso = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };

    function parseIso(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
        if (!match) return null;
        const y = Number(match[1]), m = Number(match[2]) - 1, d = Number(match[3]);
        const probe = new Date(y, m, d);
        return probe.getFullYear() === y && probe.getMonth() === m && probe.getDate() === d ? { y, m, d } : null;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // The --pj-* tokens (and the .projects-dark override) are declared on the
    // panel, not on <body>, so a popover parented to <body> renders unthemed.
    // Nothing between the panel and the root establishes a containing block,
    // so position:fixed still resolves against the viewport in here.
    function host() {
        return document.querySelector(SCOPE) || document.body;
    }

    function close() {
        if (!popover) return;
        popover.remove();
        popover = null;
        field = null;
        cursor = null;
    }

    function commit(value) {
        if (!field) return;
        if (!field.isConnected || field.disabled || field.readOnly) { close(); return; }
        const target = field;
        // Respect the field's own bounds rather than silently writing past them.
        if (value && target.min && value < target.min) return;
        if (value && target.max && value > target.max) return;
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        const trigger = target.closest('.crm-board-date-control')?.querySelector('button') || target;
        try { trigger.focus({ preventScroll: true }); } catch (_) { trigger.focus(); }
    }

    function gridMarkup() {
        const { y, m } = cursor;
        const selected = parseIso(field?.value);
        const today = todayIso();
        const first = new Date(y, m, 1);
        // getDay() is Sunday-first; shift so Monday starts the row.
        const lead = (first.getDay() + 6) % 7;
        const days = new Date(y, m + 1, 0).getDate();
        const min = field?.min || '';
        const max = field?.max || '';
        const cells = [];
        for (let i = 0; i < lead; i += 1) cells.push('<span class="crm-datepick-blank" aria-hidden="true"></span>');
        for (let d = 1; d <= days; d += 1) {
            const value = iso(y, m, d);
            const isSelected = selected && selected.y === y && selected.m === m && selected.d === d;
            const outOfRange = (min && value < min) || (max && value > max);
            cells.push(`<button type="button" class="crm-datepick-day${isSelected ? ' is-selected' : ''}${value === today ? ' is-today' : ''}"`
                + ` data-datepick-day="${value}"${outOfRange ? ' disabled' : ''}`
                + ` aria-pressed="${isSelected ? 'true' : 'false'}"`
                + ` aria-label="${escapeHtml(`${d} ${MONTHS[m]} ${y}`)}">${d}</button>`);
        }
        return cells.join('');
    }

    function render() {
        if (!popover || !cursor) return;
        const { y, m } = cursor;
        const years = [];
        for (let value = y - 6; value <= y + 6; value += 1) years.push(value);
        popover.innerHTML = `
            <div class="crm-datepick-head">
              <button type="button" class="crm-datepick-nav" data-datepick-step="-1" aria-label="Previous month">&#8249;</button>
              <label class="sr-only" for="crm-datepick-month">Month</label>
              <select id="crm-datepick-month" class="crm-datepick-select" data-datepick-month>
                ${MONTHS.map((label, index) => `<option value="${index}"${index === m ? ' selected' : ''}>${label}</option>`).join('')}
              </select>
              <label class="sr-only" for="crm-datepick-year">Year</label>
              <select id="crm-datepick-year" class="crm-datepick-select" data-datepick-year>
                ${years.map((value) => `<option value="${value}"${value === y ? ' selected' : ''}>${value}</option>`).join('')}
              </select>
              <button type="button" class="crm-datepick-nav" data-datepick-step="1" aria-label="Next month">&#8250;</button>
            </div>
            <div class="crm-datepick-weekdays" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
            <div class="crm-datepick-grid" role="group" aria-label="${escapeHtml(`${MONTHS[m]} ${y}`)}">${gridMarkup()}</div>
            <div class="crm-datepick-foot">
              <button type="button" class="crm-datepick-text" data-datepick-today>Today</button>
              <button type="button" class="crm-datepick-text" data-datepick-clear>Clear</button>
            </div>`;
    }

    function getScale() {
        const p = host();
        if (!p || p === document.body) return 1;
        const zoom = globalScope.getComputedStyle ? globalScope.getComputedStyle(p).zoom : 1;
        const n = parseFloat(zoom);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }

    function place(target) {
        const box = (target.closest('.crm-board-date-control') || target).getBoundingClientRect();
        const viewportW = globalScope.innerWidth || 1024;
        const viewportH = globalScope.innerHeight || 768;
        const scale = getScale();
        const visualWidth = WIDTH * scale;
        const left = Math.max(8, Math.min(box.left, viewportW - visualWidth - 8));
        popover.style.width = `${WIDTH}px`;
        popover.style.left = `${left / scale}px`;
        // Flip above the field when there is not enough room beneath it.
        const height = popover.offsetHeight || 300;
        const visualHeight = height * scale;
        const top = box.bottom + 6 + visualHeight > viewportH && box.top - 6 - visualHeight > 0
            ? box.top - 6 - visualHeight
            : box.bottom + 6;
        popover.style.top = `${top / scale}px`;
    }

    function open(target) {
        if (!isPickerField(target)) return;
        close();
        field = target;
        const parsed = parseIso(target.value) || parseIso(todayIso());
        cursor = { y: parsed.y, m: parsed.m };
        popover = document.createElement('div');
        popover.className = 'crm-datepick';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Choose a date');
        (target.closest('[data-projects-ui="v2"]') && target.closest('dialog[open]') || host()).appendChild(popover);
        render();
        place(target);
        popover.querySelector('.crm-datepick-day.is-selected, .crm-datepick-day.is-today, .crm-datepick-day')?.focus();
    }

    function step(delta) {
        if (!cursor) return;
        const next = new Date(cursor.y, cursor.m + delta, 1);
        cursor = { y: next.getFullYear(), m: next.getMonth() };
        render();
        if (field) place(field);
    }

    function isPickerField(node) {
        return !!node
            && node.tagName === 'INPUT'
            && node.type === 'date'
            && !node.disabled
            && !node.readOnly
            && !!node.closest?.(SCOPE);
    }

    function init() {
        if (typeof document === 'undefined' || document.__crmProjectsDatePicker) return;
        document.__crmProjectsDatePicker = true;

        document.addEventListener('mousedown', (event) => {
            const target = event.target;
            if (isPickerField(target)) {
                // Suppress the native calendar without blocking typing or focus.
                event.preventDefault();
                if (field === target) { close(); return; }
                open(target);
                return;
            }
            if (popover && !popover.contains(target)) close();
        }, true);

        document.addEventListener('click', (event) => {
            if (!popover || !popover.contains(event.target)) return;
            const day = event.target.closest('[data-datepick-day]');
            if (day) { commit(day.dataset.datepickDay); return; }
            const nav = event.target.closest('[data-datepick-step]');
            if (nav) { step(Number(nav.dataset.datepickStep)); return; }
            if (event.target.closest('[data-datepick-today]')) { commit(todayIso()); return; }
            if (event.target.closest('[data-datepick-clear]')) { commit(''); }
        });

        document.addEventListener('change', (event) => {
            if (!popover || !popover.contains(event.target) || !cursor) return;
            if (event.target.matches('[data-datepick-month]')) cursor = { ...cursor, m: Number(event.target.value) };
            else if (event.target.matches('[data-datepick-year]')) cursor = { ...cursor, y: Number(event.target.value) };
            else return;
            render();
            if (field) place(field);
        });

        document.addEventListener('keydown', (event) => {
            if (!popover) return;
            if (event.key === 'Escape') {
                if (field?.closest('[data-projects-ui="v2"]')) event.preventDefault();
                event.stopPropagation();
                const target = field;
                close();
                (target?.closest('.crm-board-date-control')?.querySelector('button') || target)?.focus();
                return;
            }
            if (!popover.contains(event.target)) return;
            const day = event.target.closest('[data-datepick-day]');
            if (!day) return;
            const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (!Object.prototype.hasOwnProperty.call(moves, event.key)) return;
            event.preventDefault();
            const parsed = parseIso(day.dataset.datepickDay);
            const next = new Date(parsed.y, parsed.m, parsed.d + moves[event.key]);
            cursor = { y: next.getFullYear(), m: next.getMonth() };
            render();
            if (field) place(field);
            popover.querySelector(`[data-datepick-day="${iso(next.getFullYear(), next.getMonth(), next.getDate())}"]`)?.focus();
        }, true);

        // The board virtualises rows, so a field can be unmounted underneath us.
        globalScope.addEventListener?.('scroll', () => { if (field && !field.isConnected) close(); }, true);
        globalScope.addEventListener?.('resize', () => { if (field) (field.isConnected ? place(field) : close()); });
    }

    globalScope.CrmProjectsDatePicker = { init, close, open };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
