/* eslint-disable no-console */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  assertLocalFirebaseIsolationEnv,
  probeLocalFirebaseEmulatorsSync
} = require('../../server');

const ENV_KEYS = [
  'NODE_ENV',
  'ALLOW_PROD_FIREBASE',
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST'
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(saved) {
  for (const k of ENV_KEYS) {
    if (saved[k] !== undefined) {
      process.env[k] = saved[k];
    } else {
      delete process.env[k];
    }
  }
}

test('probeLocalFirebaseEmulatorsSync returns true when emulators are running', () => {
  const isRunning = probeLocalFirebaseEmulatorsSync();
  assert.equal(isRunning, true, 'probeLocalFirebaseEmulatorsSync should detect active local emulators');
});

test('probeLocalFirebaseEmulatorsSync handles string, number, and empty customPorts correctly', () => {
  // String format (e.g. '8080' or '8080,9099')
  assert.equal(probeLocalFirebaseEmulatorsSync('8080'), true, 'Should accept string port');
  // Number format (e.g. 8080)
  assert.equal(probeLocalFirebaseEmulatorsSync(8080), true, 'Should accept numeric port');
  // Empty array should return false without crashing
  assert.equal(probeLocalFirebaseEmulatorsSync([]), false, 'Empty array should return false');
  // Non-numeric port string should return false without crashing
  assert.equal(probeLocalFirebaseEmulatorsSync('invalid,ports'), false, 'Invalid port string should return false');
});

test('assertLocalFirebaseIsolationEnv replaces whitespace-only env vars when emulators active', () => {
  const saved = snapshotEnv();
  try {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_PROD_FIREBASE;
    process.env.FIRESTORE_EMULATOR_HOST = '   ';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '   ';
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.STORAGE_EMULATOR_HOST;

    assertLocalFirebaseIsolationEnv();

    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, 'localhost:8080');
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'localhost:9099');
    assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'localhost:9199');
    assert.equal(process.env.STORAGE_EMULATOR_HOST, 'http://localhost:9199');
  } finally {
    restoreEnv(saved);
  }
});

test('assertLocalFirebaseIsolationEnv auto-binds emulator env vars when missing and emulators active', () => {
  const saved = snapshotEnv();
  try {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_PROD_FIREBASE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.STORAGE_EMULATOR_HOST;

    const originalLog = console.log;
    let loggedMessage = '';
    console.log = (msg) => {
      loggedMessage = msg;
    };

    try {
      assertLocalFirebaseIsolationEnv();
    } finally {
      console.log = originalLog;
    }

    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, 'localhost:8080');
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'localhost:9099');
    assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'localhost:9199');
    assert.equal(process.env.STORAGE_EMULATOR_HOST, 'http://localhost:9199');
    assert.match(
      loggedMessage,
      /\[INFO\] Detected active Firebase emulators on localhost\. Auto-bound emulator environment variables\./
    );
  } finally {
    restoreEnv(saved);
  }
});

test('assertLocalFirebaseIsolationEnv skips emulator guard in production', () => {
  const saved = snapshotEnv();
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PROD_FIREBASE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.STORAGE_EMULATOR_HOST;

    assertLocalFirebaseIsolationEnv();

    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, undefined);
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, undefined);
  } finally {
    restoreEnv(saved);
  }
});

test('assertLocalFirebaseIsolationEnv skips emulator guard when ALLOW_PROD_FIREBASE=1', () => {
  const saved = snapshotEnv();
  try {
    delete process.env.NODE_ENV;
    process.env.ALLOW_PROD_FIREBASE = '1';
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.STORAGE_EMULATOR_HOST;

    assertLocalFirebaseIsolationEnv();

    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, undefined);
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, undefined);
  } finally {
    restoreEnv(saved);
  }
});

test('assertLocalFirebaseIsolationEnv preserves existing emulator env vars', () => {
  const saved = snapshotEnv();
  try {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_PROD_FIREBASE;
    process.env.FIRESTORE_EMULATOR_HOST = 'custom-host:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'custom-host:9099';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'custom-host:9199';
    process.env.STORAGE_EMULATOR_HOST = 'http://custom-host:9199';

    assertLocalFirebaseIsolationEnv();

    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, 'custom-host:8080');
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'custom-host:9099');
    assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'custom-host:9199');
    assert.equal(process.env.STORAGE_EMULATOR_HOST, 'http://custom-host:9199');
  } finally {
    restoreEnv(saved);
  }
});

test('node server.js exits with fatal error explaining npm run dev:server when emulators inactive', () => {
  const runner = `
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.STORAGE_EMULATOR_HOST;
    delete process.env.ALLOW_PROD_FIREBASE;
    delete process.env.NODE_ENV;
    process.env.BEL_EMULATOR_PROBE_PORTS = '59998,59999';

    const { assertLocalFirebaseIsolationEnv } = require('./server');
    assertLocalFirebaseIsolationEnv();
  `;

  const result = spawnSync(process.execPath, ['-e', runner], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 1, 'Process should exit with code 1 when emulators inactive');
  assert.match(
    result.stderr,
    /\[FATAL\] Refusing to start without Firebase emulator env vars\./,
    'Stderr should include fatal message'
  );
  assert.match(
    result.stderr,
    /npm run dev:server/,
    'Stderr should mention npm run dev:server'
  );
});
