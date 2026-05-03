(function (root) {
  'use strict';

  function normalizeRoute(route, fallbackRoute) {
    if (route && typeof route === 'object') {
      return {
        main: String(route.main || fallbackRoute.main || 'dashboard').trim() || 'dashboard',
        sub: String(route.sub || '').trim()
      };
    }
    return {
      main: String(fallbackRoute.main || 'dashboard').trim() || 'dashboard',
      sub: String(fallbackRoute.sub || '').trim()
    };
  }

  function resolveDevToolsRoute(options) {
    const settings = options || {};
    const fallbackRoute = normalizeRoute(settings.fallbackRoute || { main: 'dashboard', sub: '' }, { main: 'dashboard', sub: '' });
    const route = normalizeRoute({ main: settings.main, sub: settings.sub }, fallbackRoute);
    if (route.main === 'devtools' && !settings.devToolsAvailable) {
      return fallbackRoute;
    }
    return route;
  }

  function shouldShowDevToolsNav(options) {
    return !!(options && options.devToolsAvailable);
  }

  const api = {
    resolveDevToolsRoute: resolveDevToolsRoute,
    shouldShowDevToolsNav: shouldShowDevToolsNav
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.CrmDevToolsAccess = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
