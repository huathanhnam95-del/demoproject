(function (globalScope) {
  'use strict';

  function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function isLocalAuthHost(hostname) {
    var h = String(hostname || (typeof window !== 'undefined' ? window.location.hostname : '') || '').trim().toLowerCase();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    return h === 'localhost'
      || h === '127.0.0.1'
      || h === '::1'
      || h.endsWith('.local')
      || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)
      || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
      || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h);
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
    if (!firebaseRef) {
      throw new Error('Firebase compat bootstrap is unavailable.');
    }

    const isLocal = isLocalAuthHost(options.hostname);
    const existingConfig = options.staticConfig || (typeof window !== 'undefined' ? window.__FIREBASE_CONFIG__ : null);

    if (!isLocal && Array.isArray(firebaseRef.apps) && firebaseRef.apps.length > 0) {
      await ensureCompatLocalPersistence(firebaseRef);
      return firebaseRef.apps[0]?.options || existingConfig;
    }

    if (!isLocal && existingConfig && existingConfig.apiKey) {
      if (!Array.isArray(firebaseRef.apps) || firebaseRef.apps.length === 0) {
        firebaseRef.initializeApp(existingConfig);
      }
      await ensureCompatLocalPersistence(firebaseRef);
      return existingConfig;
    }

    if (typeof fetch !== 'function') {
      if (existingConfig && existingConfig.apiKey) {
        if (!Array.isArray(firebaseRef.apps) || firebaseRef.apps.length === 0) {
          firebaseRef.initializeApp(existingConfig);
        }
        await ensureCompatLocalPersistence(firebaseRef);
        return existingConfig;
      }
      throw new Error('Firebase compat bootstrap is unavailable.');
    }

    const configUrl = String(options.configUrl || '/api/config');
    let result = null;
    let res = null;
    try {
      res = await fetch(configUrl, { cache: 'no-store' });
      result = await res.json().catch(() => null);
    } catch (fetchErr) {
      if (existingConfig && existingConfig.apiKey) {
        result = { success: true, config: existingConfig };
        res = { ok: true };
      } else {
        throw fetchErr;
      }
    }

    if (!res?.ok || !result?.success || !result?.config?.apiKey) {
      if (existingConfig && existingConfig.apiKey) {
        result = { success: true, config: existingConfig };
      } else {
        const msg = result?.message || `Could not fetch ${configUrl}. Ensure the server is running.`;
        throw new Error(msg);
      }
    }

    if (!Array.isArray(firebaseRef.apps) || firebaseRef.apps.length === 0) {
      firebaseRef.initializeApp(result.config);

        var isLocalEnv = isLocal;
        if (isLocalEnv) {
          // The local server publishes its owned emulator endpoints. Use those
          // ports so a phase harness (or another isolated session) cannot
          // silently attach the browser to a different emulator instance.
          const emulatorConfig = result.emulators || {};
          const hasEndpointOverride = Object.prototype.hasOwnProperty.call(emulatorConfig, 'auth')
            || Object.prototype.hasOwnProperty.call(emulatorConfig, 'firestore');
          let firestoreEndpoint = { host: 'localhost', port: 8080 };
          let authEndpoint = { host: 'localhost', port: 9099 };
          let storageEndpoint = { host: 'localhost', port: 9199 };
          if (hasEndpointOverride) {
            if (result.config.projectId !== 'demo-crm-projects') {
              throw new Error('Emulator endpoint overrides require the dedicated demo project.');
            }
            authEndpoint = parseLocalEmulatorEndpoint(emulatorConfig.auth, 'Auth emulator');
            firestoreEndpoint = parseLocalEmulatorEndpoint(emulatorConfig.firestore, 'Firestore emulator');
            storageEndpoint = parseLocalEmulatorEndpoint(emulatorConfig.storage, 'Storage emulator');
          }
          const firestoreHost = firestoreEndpoint.host;
          const firestorePort = firestoreEndpoint.port;
          const authHost = authEndpoint.host;
          const authPort = authEndpoint.port;
          try { firebaseRef.firestore().useEmulator(firestoreHost, firestorePort); } catch (e) { /* already connected */ }
          try { firebaseRef.auth().useEmulator(`http://${authHost}:${authPort}`, { disableWarnings: true }); } catch (e) { /* */ }
          try { if (firebaseRef.storage) firebaseRef.storage().useEmulator(storageEndpoint.host, storageEndpoint.port); } catch (e) { /* */ }
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

  async function bootstrapCompatLocalAdmin(firebaseRef, options = {}) {
    try {
      const hostname = options.hostname || (typeof window !== 'undefined' ? window.location.hostname : '');
      if (!isLocalAuthHost(hostname)) {
        return null;
      }

      if (!firebaseRef || typeof firebaseRef.auth !== 'function') {
        return null;
      }

      const auth = firebaseRef.auth();
      const currentUser = safeGetCurrentUser(() => auth.currentUser);
      if (currentUser) {
        return currentUser;
      }

      if (typeof fetch !== 'function') {
        return null;
      }

      const tokenUrl = String(options.tokenUrl || '/api/local/admin-token');
      const response = await fetch(tokenUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => null);

      if (!response || !response.ok) {
        return null;
      }

      const payload = await response.json().catch(() => null);
      if (!payload?.success || typeof payload.token !== 'string' || !payload.token) {
        return null;
      }

      await ensureCompatLocalPersistence(firebaseRef);

      if (typeof auth.signInWithCustomToken !== 'function') {
        return null;
      }

      const userCredential = await auth.signInWithCustomToken(payload.token);
      const user = userCredential?.user || auth.currentUser || null;
      return user || auth.currentUser || null;
    } catch {
      return null;
    }
  }

  const api = {
    isLocalAuthHost,
    waitForInitialAuthResolution,
    waitForStableAuthUser,
    ensureCompatLocalPersistence,
    ensureCompatFirebaseFromConfig,
    waitForCompatAuthUser,
    bootstrapCompatLocalAdmin
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.AuthSessionGuard = api;
})(typeof window !== 'undefined' ? window : globalThis);
