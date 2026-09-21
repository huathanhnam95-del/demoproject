(function () {
  'use strict';
  const RELEASE_DEFAULT = false;
  const ENABLED_MODES = ['read-aloud', 'speak', 'describe-image', 'asq', 'rts', 'sgd', 'notes'];
  let requested = null;
  try { requested = new URL(window.location.href).searchParams.get('pteShell'); } catch (_) {}
  if (!requested) {
    try { requested = localStorage.getItem('bel:pte-shell'); } catch (_) {}
  }
  const enabled = requested === 'v3' || (requested !== 'legacy' && RELEASE_DEFAULT);
  window.PteShellConfig = Object.freeze({
    enabled, requested,
    isModeEnabled(modeId, scope) {
      return enabled && (scope || 'pte') === 'pte' && ENABLED_MODES.includes(modeId);
    }
  });
})();
