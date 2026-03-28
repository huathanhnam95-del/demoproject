(function (globalScope) {
  'use strict';

  function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
      let unsubscribe = function noop() {};
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
