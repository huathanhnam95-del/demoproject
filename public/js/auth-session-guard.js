(function (globalScope) {
  'use strict';

  function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function parseLocalEmulatorEndpoint(endpoint, label) {
    const host = String(endpoint?.host || '').trim().toLowerCase();
    const port = Number(endpoint?.port);
    if (!['localhost', '127.0.0.1', '::1'].includes(host)
      || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${label} must be a valid loopback emulator endpoint.`);
    }
    return { host, port };
  }

  function safeGetCurrentUser(getCurrentUser) {
    if (typeof getCurrentUser !== 'function') return null;
    try {
      return getCurrentUser() || null;
    } catch {
      return null;
    }
  }

  function buildResolver({
    getCurrentUser,
    subscribe,
    timeoutMs,
    nullGraceMs,
    settleOnFirstNull
  }) {
    return new Promise((resolve, reject) => {
      const currentUser = safeGetCurrentUser(getCurrentUser);
      if (currentUser) {
        resolve(currentUser);
        return;
      }

      if (typeof subscribe !== 'function') {
        resolve(null);
        return;
      }

      let settled = false;
      let unsubscribe = function noop() { };
      let nullTimer = null;
      let timeoutTimer = null;

      const cleanup = () => {
        if (nullTimer) {
          clearTimeout(nullTimer);
          nullTimer = null;
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        try {
          unsubscribe();
        } catch {
          // Ignore unsubscribe failures from external SDKs.
        }
      };

      const settle = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value || null);
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const scheduleNullResolution = () => {
        if (settled) return;
        if (nullTimer) clearTimeout(nullTimer);
        nullTimer = setTimeout(() => {
          const recoveredUser = safeGetCurrentUser(getCurrentUser);
          settle(recoveredUser || null);
        }, toPositiveInt(nullGraceMs, 0));
      };

      timeoutTimer = setTimeout(() => {
        const recoveredUser = safeGetCurrentUser(getCurrentUser);
        settle(recoveredUser || null);
      }, toPositiveInt(timeoutMs, 12000));

      try {
        unsubscribe = subscribe((user) => {
          if (settled) return;
          if (user) {
            settle(user);
            return;
          }
          if (settleOnFirstNull) {
            scheduleNullResolution();
            return;
          }
          scheduleNullResolution();
        }, fail) || unsubscribe;
      } catch (error) {
        fail(error);
      }
    });
  }

  function waitForInitialAuthResolution(options = {}) {
    return buildResolver({
      getCurrentUser: options.getCurrentUser,
      subscribe: options.subscribe,
      timeoutMs: toPositiveInt(options.timeoutMs, 12000),
      nullGraceMs: toPositiveInt(options.nullGraceMs, 250),
      settleOnFirstNull: true
    });
  }

  function waitForStableAuthUser(options = {}) {
    return buildResolver({
      getCurrentUser: options.getCurrentUser,
      subscribe: options.subscribe,
      timeoutMs: toPositiveInt(options.timeoutMs, 12000),
      nullGraceMs: toPositiveInt(options.nullGraceMs, 1500),
      settleOnFirstNull: false
    });
  }

  async function ensureCompatLocalPersistence(firebaseRef) {
    if (!firebaseRef || typeof firebaseRef.auth !== 'function') return false;
    const auth = firebaseRef.auth();
    const persistenceMode = firebaseRef.auth?.Auth?.Persistence?.LOCAL;
    if (!auth || typeof auth.setPersistence !== 'function' || !persistenceMode) return false;
    try {
      await auth.setPersistence(persistenceMode);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureCompatFirebaseFromConfig(firebaseRef, options = {}) {
    if (!firebaseRef || typeof fetch !== 'function') {
      throw new Error('Firebase compat bootstrap is unavailable.');
    }

    const configUrl = String(options.configUrl || '/api/config');
    const res = await fetch(configUrl, { cache: 'no-store' });
    const result = await res.json().catch(() => null);

    if (!res.ok || !result?.success || !result?.config?.apiKey) {
      const msg = result?.message || `Could not fetch ${configUrl}. Ensure the server is running.`;
      throw new Error(msg);
    }

    if (!Array.isArray(firebaseRef.apps) || firebaseRef.apps.length === 0) {
      firebaseRef.initializeApp(result.config);

        // ── Compat Emulator Redirect ──
        // Match the same "local dev" hostname logic we use on the server side:
        // localhost, loopback, *.local, and RFC1918 IP ranges.
        var h = String(window.location.hostname || '').trim().toLowerCase();
        if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // IPv6 literal
        var isLocal = h === 'localhost'
          || h === '127.0.0.1'
          || h === '::1'
          || h.endsWith('.local')
          || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)
          || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
          || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h);
        if (isLocal) {
          // The local server publishes its owned emulator endpoints. Use those
          // ports so a phase harness (or another isolated session) cannot
          // silently attach the browser to a different emulator instance.
          const emulatorConfig = result.emulators || {};
          const hasEndpointOverride = Object.prototype.hasOwnProperty.call(emulatorConfig, 'auth')
            || Object.prototype.hasOwnProperty.call(emulatorConfig, 'firestore');
          let firestoreEndpoint = { host: 'localhost', port: 8080 };
          let authEndpoint = { host: 'localhost', port: 9099 };
          if (hasEndpointOverride) {
            if (result.config.projectId !== 'demo-crm-projects') {
              throw new Error('Emulator endpoint overrides require the dedicated demo project.');
            }
            authEndpoint = parseLocalEmulatorEndpoint(emulatorConfig.auth, 'Auth emulator');
            firestoreEndpoint = parseLocalEmulatorEndpoint(emulatorConfig.firestore, 'Firestore emulator');
          }
          const firestoreHost = firestoreEndpoint.host;
          const firestorePort = firestoreEndpoint.port;
          const authHost = authEndpoint.host;
          const authPort = authEndpoint.port;
          try { firebaseRef.firestore().useEmulator(firestoreHost, firestorePort); } catch (e) { /* already connected */ }
          try { firebaseRef.auth().useEmulator(`http://${authHost}:${authPort}`, { disableWarnings: true }); } catch (e) { /* */ }
          try { if (firebaseRef.storage) firebaseRef.storage().useEmulator('localhost', 9199); } catch (e) { /* */ }
          try { if (firebaseRef.functions) firebaseRef.functions().useEmulator('localhost', 5001); } catch (e) { /* */ }
          console.warn('🔧 [AuthGuard] Compat emulators connected.');
        }
    }

    await ensureCompatLocalPersistence(firebaseRef);
    return result.config;
  }

  function waitForCompatAuthUser(firebaseRef, options = {}) {
    if (!firebaseRef || typeof firebaseRef.auth !== 'function') {
      return Promise.resolve(null);
    }

    return waitForStableAuthUser({
      getCurrentUser: () => firebaseRef.auth().currentUser,
      subscribe: (onStateChanged, onError) => firebaseRef.auth().onAuthStateChanged(onStateChanged, onError),
      timeoutMs: options.timeoutMs,
      nullGraceMs: options.nullGraceMs
    });
  }

  const api = {
    waitForInitialAuthResolution,
    waitForStableAuthUser,
    ensureCompatLocalPersistence,
    ensureCompatFirebaseFromConfig,
    waitForCompatAuthUser
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.AuthSessionGuard = api;
})(typeof window !== 'undefined' ? window : globalThis);
