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

(async () => {
  await testImmediateUser();
  await testDelayedUser();
  await testNullThenUserWithinGrace();
  await testStableNull();
  await testInitialResolution();
  await testCompatHelpers();
  console.log('auth session guard passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
