(function () {
  'use strict';

  const RELEASE_DEFAULT = true;
  const urlParam = typeof window !== 'undefined' && window.location
    ? new URL(window.location.href).searchParams.get('raWorkspace')
    : null;
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem('raWorkspace')
    : null;
  const requested = urlParam || stored || null;

  const enabled =
    requested === 'v2' ||
    (requested !== 'legacy' && RELEASE_DEFAULT);

  const config = Object.freeze({
    enabled: Boolean(enabled),
    requested
  });

  if (typeof window !== 'undefined') {
    window.ReadAloudWorkspaceConfig = config;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = config;
  }
})();
