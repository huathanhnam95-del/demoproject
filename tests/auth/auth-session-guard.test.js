/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(process.cwd(), 'public/js/auth-session-guard.js'), 'utf8');
const sandbox = {
  module: { exports: {} },
  exports: {},
  globalThis: {},
  setTimeout,
  clearTimeout
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.location = { hostname: 'localhost' };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const guard = sandbox.module.exports;

async function testImmediateUser() {
  const user = { uid: 'u-1' };
  const result = await guard.waitForStableAuthUser({
    getCurrentUser: () => user,
    subscribe: () => () => {},
    timeoutMs: 50,
    nullGraceMs: 10
  });
  assert.strictEqual(result, user, 'Immediate current user should resolve synchronously.');
}

async function testDelayedUser() {
  const user = { uid: 'u-2' };
  const result = await guard.waitForStableAuthUser({
    getCurrentUser: () => null,
    subscribe: (onStateChanged) => {
      setTimeout(() => onStateChanged(user), 10);
      return () => {};
    },
    timeoutMs: 100,
    nullGraceMs: 20
  });
  assert.strictEqual(result, user, 'Delayed auth restore should still resolve the user.');
}

async function testNullThenUserWithinGrace() {
  const user = { uid: 'u-3' };
  const result = await guard.waitForStableAuthUser({
    getCurrentUser: () => null,
    subscribe: (onStateChanged) => {
      setTimeout(() => onStateChanged(null), 5);
      setTimeout(() => onStateChanged(user), 15);
      return () => {};
    },
    timeoutMs: 100,
    nullGraceMs: 30
  });
  assert.strictEqual(result, user, 'Transient null should not force logout before auth restore completes.');
}

async function testStableNull() {
  const result = await guard.waitForStableAuthUser({
    getCurrentUser: () => null,
    subscribe: (onStateChanged) => {
      setTimeout(() => onStateChanged(null), 5);
      return () => {};
    },
    timeoutMs: 100,
    nullGraceMs: 20
  });
  assert.strictEqual(result, null, 'Stable null should resolve as signed out after the grace window.');
}

async function testInitialResolution() {
  const result = await guard.waitForInitialAuthResolution({
    getCurrentUser: () => null,
    subscribe: (onStateChanged) => {
      setTimeout(() => onStateChanged(null), 10);
      return () => {};
    },
    timeoutMs: 100
  });
  assert.strictEqual(result, null, 'Initial auth resolution should settle to null when no user is restored.');
}

async function testCompatHelpers() {
  const firebaseRef = {
    apps: [],
    initializeAppCalls: 0,
    initializeApp(config) {
      this.initializeAppCalls += 1;
      this.apps.push(config);
    },
    auth() {
      return {
        currentUser: { uid: 'compat-user' },
        setPersistence: async () => true,
        onAuthStateChanged(onStateChanged) {
          setTimeout(() => onStateChanged({ uid: 'compat-user' }), 5);
          return () => {};
        }
      };
    }
  };
  firebaseRef.auth.Auth = { Persistence: { LOCAL: 'local' } };

  sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      config: { apiKey: 'test-key' }
    })
  });

  await guard.ensureCompatFirebaseFromConfig(firebaseRef, { configUrl: '/api/config' });
  assert.strictEqual(firebaseRef.initializeAppCalls, 1, 'Compat bootstrap should initialize Firebase from /api/config once.');

  const user = await guard.waitForCompatAuthUser(firebaseRef, {
    timeoutMs: 50,
    nullGraceMs: 10
  });
  assert.strictEqual(user?.uid, 'compat-user', 'Compat auth helper should resolve the restored user.');
}

async function testValidatedEmulatorOverrides() {
  const calls = { auth: null, firestore: null };
  const auth = {
    setPersistence: async () => true,
    useEmulator(url) { calls.auth = url; },
    onAuthStateChanged() { return () => {}; },
    currentUser: null
  };
  const firestore = { useEmulator(host, port) { calls.firestore = { host, port }; } };
  const firebaseRef = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    auth: () => auth,
    firestore: () => firestore
  };
  firebaseRef.auth.Auth = { Persistence: { LOCAL: 'local' } };
  sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      config: { apiKey: 'test-key', projectId: 'demo-crm-projects' },
      emulators: {
        auth: { host: '127.0.0.1', port: 9180 },
        firestore: { host: '127.0.0.1', port: 8188 }
      }
    })
  });
  await guard.ensureCompatFirebaseFromConfig(firebaseRef);
  assert.strictEqual(calls.auth, 'http://127.0.0.1:9180');
  assert.deepStrictEqual(calls.firestore, { host: '127.0.0.1', port: 8188 });

  const invalidFirebase = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    auth: () => auth,
    firestore: () => firestore
  };
  sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      config: { apiKey: 'test-key', projectId: 'demo-crm-projects' },
      emulators: { auth: { host: 'attacker.example', port: 9180 }, firestore: { host: '127.0.0.1', port: 8188 } }
    })
  });
  await assert.rejects(
    () => guard.ensureCompatFirebaseFromConfig(invalidFirebase),
    /loopback emulator endpoint/
  );

  const nonDemoFirebase = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    auth: () => auth,
    firestore: () => firestore
  };
  sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      config: { apiKey: 'test-key', projectId: 'legacy-local-project' },
      emulators: {
        auth: { host: '127.0.0.1', port: 9180 },
        firestore: { host: '127.0.0.1', port: 8188 }
      }
    })
  });
  await assert.rejects(
    () => guard.ensureCompatFirebaseFromConfig(nonDemoFirebase),
    /dedicated demo project/
  );
}

async function testIsLocalAuthHost() {
  assert.strictEqual(guard.isLocalAuthHost('localhost'), true);
  assert.strictEqual(guard.isLocalAuthHost('127.0.0.1'), true);
  assert.strictEqual(guard.isLocalAuthHost('::1'), true);
  assert.strictEqual(guard.isLocalAuthHost('[::1]'), true);
  assert.strictEqual(guard.isLocalAuthHost('macbook.local'), true);
  assert.strictEqual(guard.isLocalAuthHost('192.168.1.100'), true);
  assert.strictEqual(guard.isLocalAuthHost('10.0.0.1'), true);
  assert.strictEqual(guard.isLocalAuthHost('172.16.0.1'), true);
  assert.strictEqual(guard.isLocalAuthHost('172.31.255.255'), true);

  assert.strictEqual(guard.isLocalAuthHost('betterenglishlearning.com'), false);
  assert.strictEqual(guard.isLocalAuthHost('production.firebaseapp.com'), false);
  assert.strictEqual(guard.isLocalAuthHost('8.8.8.8'), false);
  assert.strictEqual(guard.isLocalAuthHost('172.32.0.1'), false);
}

async function testBootstrapCompatLocalAdmin() {
  let fetchCalled = false;
  sandbox.fetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({ success: true, token: 'custom-token-123' }) };
  };

  // 1. Production origin should be rejected immediately without calling fetch
  const prodResult = await guard.bootstrapCompatLocalAdmin({}, { hostname: 'betterenglishlearning.com' });
  assert.strictEqual(prodResult, null, 'Production hostname must return null');
  assert.strictEqual(fetchCalled, false, 'Production hostname must never call fetch');

  // 2. Active user should return immediately without calling fetch
  const existingUser = { uid: 'existing-admin' };
  const mockFirebaseWithUser = {
    auth: () => ({
      currentUser: existingUser
    })
  };
  const activeUserResult = await guard.bootstrapCompatLocalAdmin(mockFirebaseWithUser, { hostname: 'localhost' });
  assert.strictEqual(activeUserResult, existingUser, 'Active user must be returned without re-authenticating');
  assert.strictEqual(fetchCalled, false, 'Active user check must not call fetch');

  // 3. Failed token endpoint (404/503/network error)
  sandbox.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ success: false, error: 'LOCAL_ADMIN_UNAVAILABLE' })
  });
  const mockAuthWithoutUser = {
    currentUser: null,
    signInWithCustomToken: async () => { throw new Error('should not be called'); }
  };
  const mockFirebaseWithoutUser = {
    auth: () => mockAuthWithoutUser
  };
  const failedEndpointResult = await guard.bootstrapCompatLocalAdmin(mockFirebaseWithoutUser, { hostname: 'localhost' });
  assert.strictEqual(failedEndpointResult, null, 'Failed endpoint should return null');

  // 4. Invalid token payload (missing token)
  sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({ success: false })
  });
  const invalidPayloadResult = await guard.bootstrapCompatLocalAdmin(mockFirebaseWithoutUser, { hostname: 'localhost' });
  assert.strictEqual(invalidPayloadResult, null, 'Invalid payload should return null');

  // 5. Successful custom-token sign-in
  let customTokenReceived = null;
  let reloadCalled = false;
  const authedUser = {
    uid: 'local-admin-uid',
    email: 'admin@example.com',
    reload: async () => { reloadCalled = true; }
  };
  const successfulAuth = {
    currentUser: null,
    setPersistence: async () => true,
    signInWithCustomToken: async (token) => {
      customTokenReceived = token;
      successfulAuth.currentUser = authedUser;
      return { user: authedUser };
    }
  };
  const successfulFirebase = {
    auth: () => successfulAuth
  };
  successfulFirebase.auth.Auth = { Persistence: { LOCAL: 'local' } };

  sandbox.fetch = async (url, opts) => {
    assert.strictEqual(url, '/api/local/admin-token');
    assert.strictEqual(opts.method, 'POST');
    return {
      ok: true,
      json: async () => ({ success: true, token: 'mock-custom-token-xyz' })
    };
  };

  const successResult = await guard.bootstrapCompatLocalAdmin(successfulFirebase, { hostname: 'localhost' });
  assert.strictEqual(successResult, authedUser, 'Should return the authenticated user');
  assert.strictEqual(customTokenReceived, 'mock-custom-token-xyz', 'Custom token must be passed to signInWithCustomToken');
  assert.strictEqual(reloadCalled, false, 'User reload should not be invoked after successful token sign-in');
}

(async () => {
  await testImmediateUser();
  await testDelayedUser();
  await testNullThenUserWithinGrace();
  await testStableNull();
  await testInitialResolution();
  await testCompatHelpers();
  await testValidatedEmulatorOverrides();
  await testIsLocalAuthHost();
  await testBootstrapCompatLocalAdmin();
  console.log('auth session guard passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
