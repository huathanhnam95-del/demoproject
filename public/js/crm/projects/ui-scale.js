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

    function supportsCssZoom(doc) {
        const css = globalScope.CSS;
        if (css?.supports) {
            try { return !!(css.supports('zoom', '1') || css.supports('(zoom: 1)')); } catch (_) { return false; }
        }
        try {
            const probe = doc?.createElement?.('div');
            if (!probe?.style) return true;
            probe.style.zoom = '1';
            return probe.style.zoom === '1';
        } catch (_) {
            return false;
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
        const supported = supportsCssZoom(doc);

        const initialScale = supported ? readProjectsScale(s) : 100;
        applyProjectsScale(initialScale, { panel: p, input, output, storage: s, persist: false });
        if (input) {
            input.disabled = !supported;
            input.setAttribute('aria-disabled', String(!supported));
            if (!supported) input.setAttribute('aria-label', 'Interface size (not supported in this browser)');
        }
        if (output && !supported) {
            output.textContent = 'Not supported in this browser';
            output.setAttribute?.('aria-label', 'Interface size is not supported in this browser');
        }

        const onScaleInput = event => {
            if (supported) applyProjectsScale(event.target.value, { panel: p, input, output, storage: s, persist: true });
        };
        if (input) {
            input.addEventListener('input', onScaleInput);
        }

        // Section 2a: Stable unscaled portal host for View popover during drag
        const details = doc.querySelector('.crm-projects-view-options');
        const summary = details?.querySelector('summary');
        const popover = details?.querySelector('.crm-projects-view-options-popover');
        let closePortalFn = () => {};
        let disposeFn = () => {
            input?.removeEventListener?.('input', onScaleInput);
        };

        const orphanHost = doc.getElementById?.('crm-projects-view-portal-host');
        if (orphanHost?.remove) {
            const strandedPopover = orphanHost.querySelector?.('.crm-projects-view-options-popover');
            if (strandedPopover && details?.appendChild) details.appendChild(strandedPopover);
            orphanHost.remove();
        }

        if (details && summary && popover) {
            let portalHost = null;
            let placeholder = null;
            let isDragging = false;
            const summaryId = summary.id || 'projects-view-options-summary';
            const popoverId = popover.id || 'projects-view-options-popover';
            summary.id = summaryId;
            popover.id = popoverId;
            summary.setAttribute('id', summaryId);
            summary.setAttribute('aria-controls', popoverId);
            popover.setAttribute?.('id', popoverId);
            popover.setAttribute?.('aria-labelledby', summaryId);
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
                const focusInside = !!portalHost?.contains?.(doc.activeElement);
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(popover, placeholder);
                    placeholder.remove();
                }
                details.open = false;
                summary.setAttribute('aria-expanded', 'false');
                portalHost?.remove?.();
                portalHost = null;
                placeholder = null;
                if (focusInside) summary.focus?.();
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
            const onThemeButtonClick = () => {
                setTimeout(() => {
                    if (portalHost && p) {
                        portalHost.classList.toggle('projects-dark', p.classList.contains('projects-dark'));
                    }
                }, 0);
            };
            if (themeBtn) {
                themeBtn.addEventListener('click', onThemeButtonClick);
            }

            const onSummaryClick = e => {
                e.preventDefault();
                if (details.open) {
                    closePortal();
                } else {
                    details.open = true;
                    openPortal();
                }
            };
            summary.addEventListener('click', onSummaryClick);

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

            const onSummaryKeyDown = e => {
                if (e.key === 'Tab' && !e.shiftKey && details.open && portalHost) {
                    const focusables = Array.from(portalHost.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
                    if (focusables.length > 0) {
                        e.preventDefault();
                        focusables[0].focus();
                    }
                }
            };
            summary.addEventListener('keydown', onSummaryKeyDown);

            const onPointerStart = () => { isDragging = true; };
            const endDrag = () => {
                if (isDragging) {
                    isDragging = false;
                    reposition();
                }
            };

            if (input) {
                input.addEventListener('pointerdown', onPointerStart);
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
                input?.removeEventListener?.('input', onScaleInput);
                input?.removeEventListener?.('pointerdown', onPointerStart);
                themeBtn?.removeEventListener?.('click', onThemeButtonClick);
                summary.removeEventListener?.('click', onSummaryClick);
                summary.removeEventListener?.('keydown', onSummaryKeyDown);
                doc.removeEventListener?.('pointerdown', onPointerDown, true);
                doc.removeEventListener?.('keydown', onKeyDown);
                window?.removeEventListener?.('hashchange', onRouteLeave);
                window?.removeEventListener?.('popstate', onRouteLeave);
                window?.removeEventListener?.('resize', reposition);
                if (input) {
                    window?.removeEventListener?.('pointerup', endDrag);
                    window?.removeEventListener?.('pointercancel', endDrag);
                }
                details.open = false;
                summary.setAttribute('aria-expanded', 'false');
                const host = doc.getElementById?.('crm-projects-view-portal-host');
                host?.remove?.();
            };
        }

        return {
            CONFIG: PROJECTS_SCALE,
            validProjectsScale,
            readProjectsScale: () => readProjectsScale(s),
            applyProjectsScale: (val, persist) => applyProjectsScale(supported ? val : 100, { panel: p, input, output, storage: s, persist }),
            getScale: () => supported ? readProjectsScale(s) : 100,
            supported,
            isSupported: () => supported,
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
