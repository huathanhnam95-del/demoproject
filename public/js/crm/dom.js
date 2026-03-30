/**
 * CrmShellDom
 * Manages DOM annotations and UI consistency for the CRM Shell.
 */
window.CrmShellDom = (function () {
    'use strict';

    /**
     * Finds and annotates all elements marked with data-coming-soon="true"
     * Handles accessibility, pointer blocking, and visual badging.
     * 
     * @param {Element|Document} rootNode - The container to search within (defaults to document)
     */
    function annotateComingSoonButtons(rootNode = document) {
        if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;

        const label = window.CrmShellState?.comingSoonLabel || 'Soon';
        const elements = rootNode.querySelectorAll('[data-coming-soon="true"]');
        
        elements.forEach((el) => {
            // Idempotency: skip if already processed
            if (el.hasAttribute('data-annotated')) return;

            // Accessibility
            el.setAttribute('aria-disabled', 'true');
            
            // Default HTML tooltip if not provided
            if (!el.hasAttribute('title')) {
                el.setAttribute('title', `Feature ${label}`);
            }

            // Enforce behavior depending on element type
            if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
                el.disabled = true; // Native blocking
            } else {
                el.style.pointerEvents = 'none'; // CSS blocking for links/spans
            }

            // Visual badge injection
            if (typeof window.CrmShellUtils?.appendBadge === 'function') {
                window.CrmShellUtils.appendBadge(el, label);
            }

            // Mark as processed
            el.setAttribute('data-annotated', 'true');
        });
    }

    /**
     * Initializes a MutationObserver to automatically catch and annotate 
     * [data-coming-soon="true"] items that are dynamically injected into the DOM later.
     */
    function observeDynamicNavInjects() {
        if (!window.MutationObserver) return null;

        const observer = new MutationObserver((mutations) => {
            let newlyAddedElements = false;
            
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    newlyAddedElements = true;
                    break;
                }
            }

            if (newlyAddedElements) {
                // Re-run annotation globally. The data-annotated attribute prevents duplicate work.
                annotateComingSoonButtons(document.body);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        return observer;
    }

    return {
        annotateComingSoonButtons,
        observeDynamicNavInjects
    };
})();
