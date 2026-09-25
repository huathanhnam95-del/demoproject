(function () {
  'use strict';
  const RELEASE_DEFAULT = true;
  const ENABLED_MODES = ['read-aloud', 'speak', 'describe-image', 'asq', 'rts', 'sgd', 'notes'];
  let requested = null;
  try { requested = new URL(window.location.href).searchParams.get('pteShell'); } catch (_) {}
  if (!requested) {
    try { requested = localStorage.getItem('bel:pte-shell'); } catch (_) {}
  }
  const enabled = requested === 'v3' || (requested !== 'legacy' && RELEASE_DEFAULT);
  let rlSpokenAssessment = false;
  try {
    const p = new URL(window.location.href).searchParams.get('rlSpoken');
    if (p != null) rlSpokenAssessment = p === 'true' || p === '1';
  } catch (_) {}

  const configObj = {
    enabled,
    requested,
    get rlSpokenAssessment() { return rlSpokenAssessment; },
    set rlSpokenAssessment(v) { rlSpokenAssessment = Boolean(v); },
    isModeEnabled(modeId, scope) {
      return enabled && (scope || 'pte') === 'pte' && ENABLED_MODES.includes(modeId);
    }
  };

  window.PteShellConfig = configObj;

  if (typeof fetch === 'function') {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        const flag = data?.features?.rlSpokenAssessment
          ?? data?.featureFlags?.rlSpokenAssessment
          ?? data?.capabilities?.rlSpokenAssessment;
        if (typeof flag === 'boolean') {
          rlSpokenAssessment = flag;
        }
      })
      .catch(() => {});
  }
})();

