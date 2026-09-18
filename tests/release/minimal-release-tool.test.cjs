'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RELEASE_WORKSPACE = path.join(REPO_ROOT, 'tools', 'release-workspace');
const { buildDependencyCommands, buildPreparationCommands } = require(path.join(REPO_ROOT, 'scripts/release/firebase-release.cjs'));
const { runGenerator, getWorkspacePaths } = require(path.join(RELEASE_WORKSPACE, 'run-generator.cjs'));

test('Stage 5b Manifest: tools/release-workspace is private and locks exceljs', () => {
  const pkgPath = path.join(RELEASE_WORKSPACE, 'package.json');
  const lockPath = path.join(RELEASE_WORKSPACE, 'package-lock.json');
  const runnerPath = path.join(RELEASE_WORKSPACE, 'run-generator.cjs');

  assert.equal(fs.existsSync(pkgPath), true, 'package.json must exist in tools/release-workspace');
  assert.equal(fs.existsSync(lockPath), true, 'package-lock.json must exist in tools/release-workspace');
  assert.equal(fs.existsSync(runnerPath), true, 'run-generator.cjs must exist in tools/release-workspace');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.private, true, 'tools/release-workspace must be private');
  assert.equal(typeof pkg.dependencies?.exceljs, 'string', 'tools/release-workspace must declare exceljs dependency');

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(lock.lockfileVersion >= 2, true, 'package-lock.json must have lockfileVersion >= 2');
  assert.equal(Boolean(lock.packages && (lock.packages['node_modules/exceljs'] || lock.packages['']?.dependencies?.exceljs)), true, 'package-lock.json must lock exceljs');
});

test('Stage 5b Planner: hosting profile selects minimal release-workspace installation', () => {
  const ctx = {
    candidateRoot: REPO_ROOT,
    externalRoot: path.join(REPO_ROOT, 'tmp'),
    profileConfig: {
      name: 'hosting',
      products: ['hosting'],
      preparation: ['version', 'connectedSpeech']
    }
  };

  const commands = buildDependencyCommands(ctx);
  const releaseToolsCmd = commands.find(c => c.kind === 'npm-release-tools');
  const rootNpmCmd = commands.find(c => c.kind === 'npm-root');

  assert.ok(releaseToolsCmd, 'buildDependencyCommands must generate npm-release-tools command for hosting profile');
  assert.equal(rootNpmCmd, undefined, 'buildDependencyCommands must NOT generate npm-root command when release-workspace exists');
  assert.equal(releaseToolsCmd.cwd, RELEASE_WORKSPACE);
  assert.ok(releaseToolsCmd.args.includes('ci'));
});

test('Stage 5b Preparation: connectedSpeech command uses run-generator.cjs when available', () => {
  const ctx = {
    candidateRoot: REPO_ROOT,
    externalRoot: path.join(REPO_ROOT, 'tmp'),
    committerEpoch: 1700000000,
    profileConfig: {
      name: 'hosting',
      products: ['hosting'],
      preparation: ['version', 'connectedSpeech']
    }
  };

  const commands = buildPreparationCommands(ctx);
  const connectedSpeechCmd = commands.find(c => c.kind === 'connectedSpeech');
  assert.ok(connectedSpeechCmd, 'connectedSpeech command must be built');
  assert.equal(connectedSpeechCmd.args[0], 'tools/release-workspace/run-generator.cjs');
  assert.equal(connectedSpeechCmd.args[1], 'scripts/read-aloud/build-connected-speech-index.js');
});

test('Stage 5b Isolation: run-generator.cjs executes cleanly without root node_modules', () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp-release-ws-test-'));
  try {
    const testScript = path.join(tmpDir, 'test-isolated-run.cjs');
    fs.writeFileSync(testScript, `
      const ExcelJS = require('exceljs');
      if (!ExcelJS || typeof ExcelJS.Workbook !== 'function') {
        process.exit(1);
      }
      process.exit(0);
    `, 'utf8');

    const result = runGenerator(testScript, [], {
      cwd: tmpDir,
      stdio: 'pipe'
    });

    assert.equal(result.status, 0, `Isolated script execution failed: ${result.stderr?.toString()}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Stage 5b Fallback: connected-speech-index-core resolves exceljs via release-workspace', () => {
  const core = require(path.join(REPO_ROOT, 'scripts/read-aloud/connected-speech-index-core.js'));
  assert.equal(typeof core.buildConnectedSpeechIndex, 'function', 'connected-speech-index-core must export buildConnectedSpeechIndex');
});