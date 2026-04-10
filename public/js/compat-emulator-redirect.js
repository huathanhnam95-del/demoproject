/**
 * Firebase Compat SDK — Emulator Redirect
 * ─────────────────────────────────────────
 * Patches the compat SDK (firebase.firestore(), firebase.auth(), etc.)
 * to route through local emulators when running on localhost.
 *
 * Must be loaded AFTER compat SDK scripts and AFTER firebase.initializeApp().
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

    if (!isLocal) return;
    if (typeof firebase === 'undefined') return;

    try {
        firebase.firestore().useEmulator('localhost', 8080);
    } catch (e) {
        console.warn('[Compat emulator] Firestore:', e.message);
    }

    try {
        firebase.auth().useEmulator('http://localhost:9099', { disableWarnings: true });
    } catch (e) {
        console.warn('[Compat emulator] Auth:', e.message);
    }

    try {
        if (typeof firebase.storage === 'function') {
            firebase.storage().useEmulator('localhost', 9199);
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
