(function (globalScope) {
    'use strict';
    const LEGACY_KEY = 'crm:projects:ui-scale';
    const percent = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() && Number.isInteger(Number(value)) && Number(value) >= 70 && Number(value) <= 150 && Number(value) % 5 === 0 ? Number(value) : null;
    function createController(deps = {}) {
        const doc = deps.document || globalScope.document, panel = deps.panel;
        const actorUid = String(deps.getCurrentUser?.()?.uid || '');
        const key = `crm:projects:v2:prefs:1:${encodeURIComponent(actorUid)}`;
        let storage, initialized = false, disposed = false;
        let state = { schemaVersion: 1, textPercent: 100, density: 'comfortable', legacyPercent: null };
        const removers = [], restores = [];
        let initialDensity = 'comfortable';
        function preserveStyle(node, name) {
            if (!node) return;
            const value = node.style.getPropertyValue(name), priority = node.style.getPropertyPriority(name);
            restores.push(() => { if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name); });
        }
        const current = () => !disposed && actorUid && String(deps.getCurrentUser?.()?.uid || '') === actorUid;
        function persist() { if (current()) { try { storage?.setItem(key, JSON.stringify(state)); } catch (_) { /* in-memory remains usable */ } } }
        function apply() {
            if (!current()) return;
            // Capture the board's scroll anchor before typography changes its layout.
            deps.onDensity?.(state.density, state.textPercent / 100);
            panel?.style.setProperty('--pj-v2-text-scale', String(state.textPercent / 100));
            const input = doc?.getElementById('projects-ui-scale'), output = doc?.getElementById('projects-ui-scale-value');
            if (input) { input.value = String(state.textPercent); input.setAttribute('aria-valuenow', String(state.textPercent)); input.setAttribute('aria-valuetext', `${state.textPercent}% text size`); }
            if (output) output.textContent = `${state.textPercent}%`;
            const button = doc?.getElementById('btn-projects-density');
            if (button) { button.setAttribute('aria-pressed', String(state.density === 'compact')); button.textContent = state.density === 'compact' ? 'Compact rows' : 'Comfortable rows'; }
        }
        return {
            init() {
                if (initialized || !current()) return;
                initialized = true;
                preserveStyle(panel, '--pj-v2-text-scale');
                preserveStyle(panel, '--crm-projects-ui-scale');
                preserveStyle(doc?.getElementById('projects-board-table-wrap'), '--pj-row-h');
                panel?.style.setProperty('--crm-projects-ui-scale', '1');
                const densityButton = doc?.getElementById('btn-projects-density');
                initialDensity = densityButton?.getAttribute('aria-pressed') === 'true' ? 'compact' : 'comfortable';
                for (const node of [densityButton, doc?.getElementById('projects-ui-scale'), doc?.getElementById('projects-ui-scale-value')]) {
                    if (!node) continue;
                    const attrs = [...node.attributes].map(attr => [attr.name, attr.value]), text = node.textContent, value = node.value;
                    restores.push(() => { [...node.attributes].forEach(attr => node.removeAttribute(attr.name)); attrs.forEach(([name, val]) => node.setAttribute(name, val)); node.textContent = text; if (value !== undefined) node.value = value; });
                }
                try { storage = deps.storage !== undefined ? deps.storage : globalScope.localStorage; } catch (_) { storage = null; }
                let raw = null, stored = null;
                try { raw = storage?.getItem(LEGACY_KEY); stored = JSON.parse(storage?.getItem(key) || 'null'); } catch (_) { /* invalid/denied storage */ }
                if (stored?.schemaVersion === 1 && percent(stored.textPercent) && ['comfortable', 'compact'].includes(stored.density)) {
                    state = { schemaVersion: 1, textPercent: percent(stored.textPercent), density: stored.density, legacyPercent: percent(stored.legacyPercent) };
                } else {
                    // Missing old value is NOT the old 125% fallback. Explicit
                    // 70..150% maps 1:1 to text size; the legacy key is untouched.
                    state.textPercent = percent(raw) || 100;
                    state.legacyPercent = percent(raw);
                    persist();
                }
                const input = doc?.getElementById('projects-ui-scale'), label = doc?.querySelector('label[for="projects-ui-scale"]');
                if (label) { const text = label.textContent; restores.push(() => { label.textContent = text; }); label.textContent = 'Text size'; }
                if (input) {
                    const handler = () => { if (!current()) return; state.textPercent = percent(input.value) || state.textPercent; apply(); persist(); };
                    input.addEventListener('input', handler); removers.push(() => input.removeEventListener('input', handler));
                }
                apply();
            },
            setDensity(mode) { if (!current()) return; state.density = mode === 'compact' ? 'compact' : 'comfortable'; apply(); persist(); },
            getState: () => ({ ...state }),
            dispose() {
                if (disposed) return;
                disposed = true; removers.forEach(remove => remove());
                if (initialized) deps.onDensity?.(initialDensity);
                restores.forEach(restore => restore());
            }
        };
    }
    globalScope.CrmProjectsPreferencesV2 = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
