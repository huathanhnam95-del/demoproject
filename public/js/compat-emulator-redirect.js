/**
 * Firebase Compat SDK — Emulator Redirect
 * ─────────────────────────────────────────
 * Patches the compat SDK (firebase.firestore(), firebase.auth(), etc.)
 * to route through local emulators when running on localhost.
 *
 * Must be loaded after the compat SDK scripts and default config.
 */
(function () {
    'use strict';

    var isLocal = (function () {
        var h = String(window.location.hostname || '').trim().toLowerCase();
        if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // IPv6 literal
        return h === 'localhost'
            || h === '127.0.0.1'
            || h === '::1'
            || h.endsWith('.local')
            || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)
            || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
            || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h);
    })();

    if (typeof firebase === 'undefined') return;

    var config = window.__BEL_COMPAT_DEFAULT_CONFIG__;
    var endpoints = null;
    if (isLocal) {
        // Compat scripts run before the app's modules, so resolve the demo
        // configuration synchronously before creating any Firebase instance.
        // This branch is local-only and does not change production startup.
        var request = new XMLHttpRequest();
        request.open('GET', '/api/config', false);
        request.send();
        if (request.status === 200) {
            var local = JSON.parse(request.responseText);
            if (local.config && local.config.projectId === 'demo-crm-projects') {
                var valid = function (item) {
                    return item && (item.host === 'localhost' || item.host === '127.0.0.1')
                        && Number.isInteger(item.port) && item.port > 0 && item.port < 65536;
                };
                if (!local.config.apiKey || !valid(local.emulators && local.emulators.auth)
                    || !valid(local.emulators && local.emulators.firestore)
                    || !valid(local.emulators && local.emulators.storage)
                    || window.__DISABLE_FIREBASE_EMULATORS__) {
                    throw new Error('DEMO_FIREBASE_CONFIG_INCOMPLETE');
                }
                config = local.config;
                endpoints = local.emulators;
            }
        }
    }
    if (!firebase.apps.length) firebase.initializeApp(config);
    if (!isLocal || window.__DISABLE_FIREBASE_EMULATORS__) return;

    var auth = endpoints ? endpoints.auth : { host: 'localhost', port: 9099 };
    var firestore = endpoints ? endpoints.firestore : { host: 'localhost', port: 8080 };
    var storage = endpoints ? endpoints.storage : { host: 'localhost', port: 9199 };

    try {
        firebase.firestore().useEmulator(firestore.host, firestore.port);
    } catch (e) {
        console.warn('[Compat emulator] Firestore:', e.message);
    }

    try {
        firebase.auth().useEmulator('http://' + auth.host + ':' + auth.port, { disableWarnings: true });
    } catch (e) {
        console.warn('[Compat emulator] Auth:', e.message);
    }

    try {
        if (typeof firebase.storage === 'function') {
            firebase.storage().useEmulator(storage.host, storage.port);
        }
    } catch (e) {
        console.warn('[Compat emulator] Storage:', e.message);
    }

    try {
        if (typeof firebase.functions === 'function') {
            firebase.functions().useEmulator('localhost', 5001);
        }
    } catch (e) {
        console.warn('[Compat emulator] Functions:', e.message);
    }

    console.warn('🔧 [Compat] Firebase Emulators active — local data only.');
})();
