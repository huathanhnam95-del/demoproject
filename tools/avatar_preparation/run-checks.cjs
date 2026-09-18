'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const evidence = process.env.AVATAR_EVIDENCE_DIR || path.join(os.homedir(), '.codex', 'avatar-preparation-task', 'verification', `${Date.now()}-${crypto.randomUUID()}`);
fs.mkdirSync(evidence, { recursive: true });
const commands = [['--test', 'tests/avatar-preparation/schema-and-pack.test.mjs', 'tests/avatar-preparation/store-and-package.test.cjs', 'tests/avatar-preparation/server.test.cjs']];
if (process.argv.includes('--browser')) commands.push(['tests/browser/avatar-preparation-browser-check.cjs']);
const results = [];
for (const [index, args] of commands.entries()) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, AVATAR_EVIDENCE_DIR: evidence }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || ''); fs.writeFileSync(path.join(evidence, `check-${index + 1}.log`), output); process.stdout.write(output);
  results.push({ command: ['node', ...args], exitCode: result.status, signal: result.signal, error: result.error?.message });
  if (result.status !== 0) break;
}
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify({ sourceRoot: root, sourceSha: sha, capturedAt: new Date().toISOString(), fixtureIdentity: 'Deterministic generated test media; no physical camera or microphone', results, retention: 'Retained in external task evidence; restore from source plus commands. User media is not included.' }, null, 2));
console.log(`Evidence: ${evidence}`); process.exitCode = results.every(result => result.exitCode === 0) ? 0 : 1;
