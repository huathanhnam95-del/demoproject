#!/usr/bin/env node
/**
 * Cross-platform helper to start Firebase emulators with persistence.
 *
 * - Exports state on clean shutdown to `.local/firebase-emulator-data`
 * - Imports state if an export manifest exists
 *
 * This keeps Auth emulator users (including the admin account) stable across restarts.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ID = 'listening-tasks-3ae34';
const ONLY = 'firestore,auth,functions,storage';

const dataDir = path.resolve(__dirname, '..', '.local', 'firebase-emulator-data');
fs.mkdirSync(dataDir, { recursive: true });

const metadataPath = path.join(dataDir, 'firebase-export-metadata.json');
const args = [
  'firebase',
  'emulators:start',
  '--only',
  ONLY,
  '--project',
  PROJECT_ID
];

if (fs.existsSync(metadataPath)) {
  args.push(`--import=${dataDir}`);
}

args.push(`--export-on-exit=${dataDir}`);

// Node >= 18.20 refuses to spawn a .cmd shim without a shell (CVE-2024-27980),
// which surfaces here as `spawn EINVAL`. Use a shell on Windows and quote any
// argument containing spaces, since the repo path itself has one.
const isWindows = process.platform === 'win32';
const cmd = isWindows ? 'npx.cmd' : 'npx';
const spawnArgs = isWindows
  ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
  : args;
const child = spawn(cmd, spawnArgs, { stdio: 'inherit', shell: isWindows });

child.on('exit', (code) => {
  process.exit(typeof code === 'number' ? code : 1);
});

