(function () {
  'use strict';

  function init() {
    const openButton = document.getElementById('crm-presentation-demo-open');
    const status = document.getElementById('crm-presentation-demo-status');
    const fallbackLink = document.getElementById('crm-presentation-demo-link');
    if (!openButton || openButton.dataset.bound === 'true') return;
    openButton.dataset.bound = 'true';
    openButton.addEventListener('click', () => {
      const popup = window.open('/presentation-demo/index.html', '_blank', 'noopener,noreferrer');
      if (popup) {
        if (status) status.textContent = 'Presentation Demo opened in a new tab. Keep this CRM tab open for room management.';
        return;
      }
      if (status) status.textContent = 'The browser blocked the new tab. Use the fallback link or allow popups for this CRM site.';
      if (fallbackLink) fallbackLink.hidden = false;
    });
  }

  window.CrmPresentationDemoWorkspace = { init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
