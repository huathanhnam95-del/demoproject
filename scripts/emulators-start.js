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

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(cmd, args, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(typeof code === 'number' ? code : 1);
});

