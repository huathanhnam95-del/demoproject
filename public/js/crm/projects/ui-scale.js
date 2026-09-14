(function (globalScope) {
    'use strict';

    const PROJECTS_SCALE = Object.freeze({
        key: 'crm:projects:ui-scale',
        min: 70,
        max: 150,
        step: 5,
        fallback: 125
    });

    function validProjectsScale(value) {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        const n = Number(value);
        if (!Number.isInteger(n)) return null;
        if (n < PROJECTS_SCALE.min || n > PROJECTS_SCALE.max) return null;
        if ((n - PROJECTS_SCALE.min) % PROJECTS_SCALE.step !== 0) return null;
        return n;
    }

    function readProjectsScale(storage) {
        const s = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);
        try {
            return validProjectsScale(s?.getItem?.(PROJECTS_SCALE.key)) || PROJECTS_SCALE.fallback;
        } catch (_) {
            return PROJECTS_SCALE.fallback;
        }
    }

    function applyProjectsScale(percent, options = {}) {
        const safe = validProjectsScale(percent) || PROJECTS_SCALE.fallback;
        const doc = options.document || (typeof document !== 'undefined' ? document : null);
        const panel = options.panel || doc?.querySelector?.('[data-panel="projects"]');
        const input = options.input || doc?.getElementById?.('projects-ui-scale');
        const output = options.output || doc?.getElementById?.('projects-ui-scale-value');
        const storage = options.storage !== undefined ? options.storage : (typeof window !== 'undefined' ? window.localStorage : null);
        const persist = options.persist !== false;

        if (panel && panel.style) {
            panel.style.setProperty('--crm-projects-ui-scale', String(safe / 100));
        }
        if (input) {
            input.value = String(safe);
            input.setAttribute('aria-valuenow', String(safe));
            input.setAttribute('aria-valuetext', String(safe) + '%');
        }
        if (output) {
            output.textContent = String(safe) + '%';
        }
        if (persist && storage) {
            try {
                storage.setItem(PROJECTS_SCALE.key, String(safe));
            } catch (_) {
                // Ignore storage write failures (quota/private mode)
            }
        }
        return safe;
    }

    function init({ elements = {}, panel, storage } = {}) {
        if (typeof document === 'undefined') return null;
        const doc = document;
        const p = panel || doc.querySelector('[data-panel="projects"]');
        const input = elements.projectsUiScale || doc.getElementById('projects-ui-scale');
        const output = elements.projectsUiScaleValue || doc.getElementById('projects-ui-scale-value');
        const s = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);

        const initialScale = readProjectsScale(s);
        applyProjectsScale(initialScale, { panel: p, input, output, storage: s, persist: false });

        if (input) {
            input.addEventListener('input', (event) => {
                applyProjectsScale(event.target.value, { panel: p, input, output, storage: s, persist: true });
            });
        }

        // Section 2a: Stable unscaled portal host for View popover during drag
        const details = doc.querySelector('.crm-projects-view-options');
        const summary = details?.querySelector('summary');
        const popover = details?.querySelector('.crm-projects-view-options-popover');
        let closePortalFn = () => {};
        let disposeFn = () => {};

        if (details && summary && popover) {
            let portalHost = null;
            let placeholder = null;
            let isDragging = false;
            summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');

            const openPortal = () => {
                if (portalHost) return;
                const sumRect = summary.getBoundingClientRect();
                portalHost = doc.createElement('div');
                portalHost.id = 'crm-projects-view-portal-host';
                portalHost.className = 'crm-projects-portal-host';
                if (p?.classList?.contains('projects-dark')) {
                    portalHost.classList.add('projects-dark');
                }
                const popoverWidth = Math.min(240, (window.innerWidth || 1024) - 16);
                const left = Math.max(8, Math.min(sumRect.right - popoverWidth, (window.innerWidth || 1024) - popoverWidth - 8));
                portalHost.style.left = `${left}px`;
                portalHost.style.top = `${sumRect.bottom + 6}px`;
                portalHost.style.width = `${popoverWidth}px`;

                summary.setAttribute('aria-expanded', 'true');
                placeholder = doc.createComment('crm-projects-view-popover-placeholder');
                popover.parentNode.insertBefore(placeholder, popover);
                portalHost.appendChild(popover);
                doc.body.appendChild(portalHost);
            };

            const closePortal = () => {
                if (!portalHost) return;
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(popover, placeholder);
                    placeholder.remove();
                }
                summary.setAttribute('aria-expanded', 'false');
                portalHost.remove();
                portalHost = null;
                placeholder = null;
            };
            closePortalFn = closePortal;

            const reposition = () => {
                if (!portalHost || isDragging) return;
                if (p && (p.hidden || (p.style && p.style.display === 'none'))) {
                    details.open = false;
                    closePortal();
                    return;
                }
                const sumRect = summary.getBoundingClientRect();
                if (sumRect.width === 0 && sumRect.height === 0) {
                    details.open = false;
                    closePortal();
                    return;
                }
                const popoverWidth = Math.min(240, (window.innerWidth || 1024) - 16);
                const left = Math.max(8, Math.min(sumRect.right - popoverWidth, (window.innerWidth || 1024) - popoverWidth - 8));
                portalHost.style.left = `${left}px`;
                portalHost.style.top = `${sumRect.bottom + 6}px`;
                portalHost.style.width = `${popoverWidth}px`;
            };

            let themeObserver = null;
            if (typeof MutationObserver !== 'undefined' && p) {
                themeObserver = new MutationObserver(() => {
                    if (portalHost) {
                        portalHost.classList.toggle('projects-dark', p.classList.contains('projects-dark'));
                    }
                });
                themeObserver.observe(p, { attributes: true, attributeFilter: ['class'] });
            }

            const themeBtn = popover.querySelector('#btn-projects-theme');
            if (themeBtn) {
                themeBtn.addEventListener('click', () => {
                    setTimeout(() => {
                        if (portalHost && p) {
                            portalHost.classList.toggle('projects-dark', p.classList.contains('projects-dark'));
                        }
                    }, 0);
                });
            }

            summary.addEventListener('click', (e) => {
                e.preventDefault();
                if (details.open) {
                    details.open = false;
                    closePortal();
                } else {
                    details.open = true;
                    openPortal();
                }
            });

            const onPointerDown = (e) => {
                if (!details.open) return;
                if (portalHost && portalHost.contains(e.target)) return;
                if (summary.contains(e.target)) return;
                details.open = false;
                closePortal();
            };
            doc.addEventListener('pointerdown', onPointerDown, true);

            const onKeyDown = (e) => {
                if (!details.open) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    details.open = false;
                    closePortal();
                    summary.focus();
                    return;
                }
                if (portalHost && portalHost.contains(e.target) && e.key === 'Tab') {
                    const focusables = Array.from(portalHost.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
                    if (focusables.length === 0) return;
                    const first = focusables[0];
                    const last = focusables[focusables.length - 1];
                    if (e.shiftKey && e.target === first) {
                        e.preventDefault();
                        summary.focus();
                    } else if (!e.shiftKey && e.target === last) {
                        e.preventDefault();
                        details.open = false;
                        closePortal();
                        const next = details.nextElementSibling;
                        if (next && typeof next.focus === 'function') next.focus();
                    }
                }
            };
            doc.addEventListener('keydown', onKeyDown);

            summary.addEventListener('keydown', (e) => {
                if (e.key === 'Tab' && !e.shiftKey && details.open && portalHost) {
                    const focusables = Array.from(portalHost.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
                    if (focusables.length > 0) {
                        e.preventDefault();
                        focusables[0].focus();
                    }
                }
            });

            const endDrag = () => {
                if (isDragging) {
                    isDragging = false;
                    reposition();
                }
            };

            if (input) {
                input.addEventListener('pointerdown', () => { isDragging = true; });
                window?.addEventListener?.('pointerup', endDrag);
                window?.addEventListener?.('pointercancel', endDrag);
            }

            const onRouteLeave = () => {
                if (details.open) {
                    details.open = false;
                    closePortal();
                }
            };
            window?.addEventListener?.('hashchange', onRouteLeave);
            window?.addEventListener?.('popstate', onRouteLeave);
            window?.addEventListener?.('resize', reposition);

            disposeFn = () => {
                closePortal();
                themeObserver?.disconnect();
                doc.removeEventListener?.('pointerdown', onPointerDown, true);
                doc.removeEventListener?.('keydown', onKeyDown);
                window?.removeEventListener?.('hashchange', onRouteLeave);
                window?.removeEventListener?.('popstate', onRouteLeave);
                window?.removeEventListener?.('resize', reposition);
                if (input) {
                    window?.removeEventListener?.('pointerup', endDrag);
                    window?.removeEventListener?.('pointercancel', endDrag);
                }
            };
        }

        return {
            CONFIG: PROJECTS_SCALE,
            validProjectsScale,
            readProjectsScale: () => readProjectsScale(s),
            applyProjectsScale: (val, persist) => applyProjectsScale(val, { panel: p, input, output, storage: s, persist }),
            getScale: () => readProjectsScale(s),
            closePortal: closePortalFn,
            dispose: disposeFn
        };
    }

    const api = {
        CONFIG: PROJECTS_SCALE,
        validProjectsScale,
        readProjectsScale,
        applyProjectsScale,
        init
    };
    globalScope.CrmProjectsUiScale = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
