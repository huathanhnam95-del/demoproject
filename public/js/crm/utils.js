window.CrmShellUtils = (function () {
    function appendBadge(target, text) {
        if (!target || target.querySelector('.crm-coming-soon-badge')) return;
        const badge = document.createElement('span');
        badge.className = 'crm-coming-soon-badge';
        badge.textContent = text;
        target.appendChild(badge);
    }

    return {
        appendBadge
    };
})();
