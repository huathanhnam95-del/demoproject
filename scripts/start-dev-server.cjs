#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

// Pre-set emulator environment variables if not already defined (or if whitespace-only)
if (!String(process.env.FIRESTORE_EMULATOR_HOST || '').trim()) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
}
if (!String(process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim()) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
}
if (!String(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '').trim()) {
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
}
if (!String(process.env.STORAGE_EMULATOR_HOST || '').trim()) {
  process.env.STORAGE_EMULATOR_HOST = 'http://localhost:9199';
}

console.log('[INFO] Starting dev server with emulator environment variables:');
console.log(`  FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}`);
console.log(`  FIREBASE_AUTH_EMULATOR_HOST=${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
console.log(`  FIREBASE_STORAGE_EMULATOR_HOST=${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`);
console.log(`  STORAGE_EMULATOR_HOST=${process.env.STORAGE_EMULATOR_HOST}`);

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'server.js');

const child = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env
});

const forwardSignal = (signal) => {
  if (child && !child.killed) {
    try {
      child.kill(signal);
    } catch (_e) {
      // Process may already be exiting
    }
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
    } catch (_e) {
      process.exit(1);
    }
  } else {
    process.exit(code ?? 0);
  }
});

child.on('error', (err) => {
  console.error('[FATAL] Failed to spawn dev server:', err?.message || err);
  process.exit(1);
});
