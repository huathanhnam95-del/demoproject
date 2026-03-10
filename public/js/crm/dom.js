window.CrmShellDom = (function () {
    function annotateComingSoonButtons() {
        const label = window.CrmShellState?.comingSoonLabel || 'Coming soon';
        const buttons = document.querySelectorAll('[data-coming-soon="true"]');
        buttons.forEach((button) => {
            button.setAttribute('aria-disabled', 'true');
            if (window.CrmShellUtils?.appendBadge) {
                window.CrmShellUtils.appendBadge(button, label);
            }
        });
    }

    return {
        annotateComingSoonButtons
    };
})();
