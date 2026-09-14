'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/bel-demo/online-emulators.json'), 'utf8'));

function assertSafeEnvironment(environment = process.env) {
  const project = String(environment.FIREBASE_PROJECT_ID || '').trim();
  if (project && project !== config.projectId) throw new Error(`Refusing rehearsal for non-demo project: ${project}`);
  if (environment.GOOGLE_APPLICATION_CREDENTIALS || environment.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('Refusing rehearsal with production credential environment variables.');
  }
}

function runUnit(evidenceDir) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const files = fs.readdirSync(path.join(repo, 'tests/bel-demo-online')).filter(name => /\.test\.(cjs|mjs)$/.test(name)).sort();
  const result = spawnSync(process.execPath, ['--test', ...files.map(name => path.join(repo, 'tests/bel-demo-online', name))], { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(evidenceDir, 'emulator-unit.log'), `${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) throw new Error(`Online emulator rehearsal unit stage failed with exit ${result.status}.`);
  return { mode: 'emulators', projectId: config.projectId, unitTests: files.length, exitCode: result.status, evidence: path.join(evidenceDir, 'emulator-unit.log') };
}

function main() {
  assertSafeEnvironment();
  const args = new Set(process.argv.slice(2));
  if (!args.has('--emulators')) throw new Error('Usage: node scripts/bel-demo/rehearse-online.cjs --emulators --evidence <external-dir>');
  const evidenceIndex = process.argv.indexOf('--evidence');
  const evidenceDir = evidenceIndex >= 0 ? path.resolve(process.argv[evidenceIndex + 1]) : null;
  if (!evidenceDir) throw new Error('An external --evidence directory is required.');
  // The candidate keeps the emulator topology explicit and refuses live
  // Firebase. Full Auth/Firestore/RTDB process orchestration belongs to the
  // release-owned emulator host; this bounded stage proves the candidate's
  // authority contracts without silently connecting to production.
  console.log(JSON.stringify(runUnit(evidenceDir), null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
