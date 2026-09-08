'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const checker = require('../../scripts/structure/check.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const ADOPTION = 'ffbc380ae0790d92eb904ddc6edb183748f00c06';
const TEST_ROOT = process.env.STR01_TEST_ROOT || path.join(os.tmpdir(), 'cursor-ai-structure-str01-b7c0-20260907');

fs.mkdirSync(TEST_ROOT, { recursive: true });

function tempDir() {
  return fs.mkdtempSync(path.join(TEST_ROOT, 'str01-fixture-'));
}

function writeFile(root, rel, content) {
  const target = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initGit(root) {
  const result = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function git(root, args, options = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', ...options });
  if (!options.allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function addAdoptionAlternate(root) {
  const commonGit = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(commonGit.status, 0, commonGit.stderr);
  const gitDir = path.resolve(root, git(root, ['rev-parse', '--git-dir']).stdout.trim());
  const objects = path.resolve(commonGit.stdout.trim(), 'objects').replaceAll('\\', '/');
  fs.mkdirSync(path.join(gitDir, 'objects', 'info'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'objects', 'info', 'alternates'), `${objects}\n`);
}

function commitGit(root, files) {
  for (const args of [['config', 'user.email', 'fixture@example.invalid'], ['config', 'user.name', 'fixture']]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  let result = spawnSync('git', ['-C', root, 'add', ...files], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync('git', ['-C', root, 'commit', '--quiet', '-m', 'fixture'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    adoptionSha: ADOPTION,
    supportedRoots: ['public', 'functions', 'src', 'backend', 'scripts', 'tests', 'docs', 'agent_docs', 'assets', 'data', 'tools'],
    rootEntries: [{ path: 'README.md', role: 'navigation' }, { path: 'package.json', role: 'package manifest' }],
    domains: [{ id: 'demo', roots: ['public/js/demo', 'tests/demo'], owner: 'fixture-owner' }],
    artifactClasses: {
      dependency: ['node_modules/**'],
      cache: ['.cache/**'],
      'ephemeral-evidence': ['test-results/**']
    },
    commands: [{
      name: 'demo',
      program: 'node',
      args: ['scripts/demo.js'],
      target: 'scripts/demo.js',
      effects: ['local-write']
    }],
    generatedFamilies: [],
    exceptions: [],
    ...overrides
  };
}

function baseline(findings = []) {
  return {
    schemaVersion: 1,
    adoptionSha: ADOPTION,
    metadata: {
      owner: 'unassigned',
      triageStatus: 'triage-required',
      rationale: 'Synthetic fixture observed for the STR-01 test.',
      reviewDate: '2026-09-07',
      observationSha: ADOPTION
    },
    findings
  };
}

function writeGovernanceFixture(root, options = {}) {
  writeFile(root, 'README.md', '# STR-01 fixture\n');
  writeFile(root, 'package.json', `${JSON.stringify({
    name: 'str01-fixture',
    scripts: { demo: 'node scripts/demo.js' }
  }, null, 2)}\n`);
  writeFile(root, 'public/ok.js', 'window.fixture = true;\n');
  writeFile(root, 'scripts/demo.js', "'use strict';\n");
  writeFile(root, 'scripts/structure/policy.json', `${JSON.stringify(options.policy || policy(), null, 2)}\n`);
  writeFile(root, 'scripts/structure/legacy-baseline.json', `${JSON.stringify(options.baseline || baseline(), null, 2)}\n`);
}

function commitAll(root, message = 'fixture') {
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

function runCli(root, args) {
  const script = path.resolve(__dirname, '../../scripts/structure/check.cjs');
  const result = spawnSync(process.execPath, [script, ...args, '--root', root], { cwd: process.cwd(), encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* assertions include raw output */ }
  return { ...result, report };
}

function validFixture(options = {}) {
  const root = tempDir();
  initGit(root);
  addAdoptionAlternate(root);
  writeGovernanceFixture(root, options);
  return root;
}

function externalContractAndSnapshot(root, baseSha, overrides = {}) {
  const external = tempDir();
  const c = contract(external, { baseSha, ...overrides });
  const contractPath = path.join(external, 'structure-contract.json');
  const snapshotPath = path.join(external, 'structure-before.json');
  fs.writeFileSync(contractPath, `${JSON.stringify(c, null, 2)}\n`);
  const result = runCli(root, ['snapshot', '--contract', contractPath, '--out', snapshotPath, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(snapshotPath), true);
  return { c, contractPath, snapshotPath, external };
}

function contract(root, overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: 'STR-01-test',
    baseSha: SHA_A,
    owner: 'fixture-owner',
    changes: { create: [], modify: [], delete: [], rename: [] },
    outputs: [{ root, class: 'ephemeral-evidence', tracked: false }],
    protectedContracts: ['fixture contract'],
    verification: ['node --test'],
    exceptions: [],
    ...overrides
  };
}

function snapshot(root, c, files = {}) {
  const bytes = JSON.stringify(c);
  return {
    schemaVersion: 1,
    taskId: c.taskId,
    root,
    baseSha: c.baseSha,
    contractSha256: sha256(bytes),
    capturedAt: new Date().toISOString(),
    files,
    excluded: ['.git', 'node_modules', '.venv', 'venv', 'Kokoro-FastAPI', '.firebase'],
    links: [],
    gitStatus: '',
    bootstrap: 'Manual pre-coding snapshot; eventual checker must validate this schema and declared delta.'
  };
}

test('normalizes safe Unicode paths and rejects traversal, drive, UNC, and case collisions', () => {
  assert.equal(checker.normalizeRepoPath('public\\Việt Nam/file.js'), 'public/Việt Nam/file.js');
  assert.throws(() => checker.normalizeRepoPath('../secret.txt'), /traversal/i);
  assert.throws(() => checker.normalizeRepoPath('C:\\secret.txt'), /drive|absolute/i);
  assert.throws(() => checker.normalizeRepoPath('\\\\server\\share\\secret.txt'), /UNC|absolute/i);
  assert.deepEqual(checker.findCaseCollisions(['public/A.js', 'public/a.js']), ['public/A.js', 'public/a.js']);
});

test('validates the external contract and snapshot schema including exact contract bytes', () => {
  const root = path.join(tempDir(), 'external task');
  const c = contract(root);
  const cValidation = checker.validateContract(c, { externalRoot: root });
  assert.equal(cValidation.ok, true, JSON.stringify(cValidation));
  const s = snapshot(root, c);
  assert.equal(checker.validateSnapshot(s, c, JSON.stringify(c)).ok, true);
  assert.equal(checker.validateSnapshot({ ...s, contractSha256: '0'.repeat(64) }, c, JSON.stringify(c)).ok, false);
  assert.equal(checker.validateContract({ ...c, outputs: [{ root: path.join(tempDir(), 'inside'), class: 'ephemeral-evidence', tracked: false }] }, { externalRoot: root }).ok, false);
  assert.equal(checker.validateContract({ ...c, changes: { ...c.changes, create: ['../escape.js'] } }, { externalRoot: root }).ok, false);
});

test('snapshot captures files and writes only the requested external output', () => {
  const root = tempDir();
  const external = tempDir();
  initGit(root);
  writeFile(root, 'public/ok.js', 'ok');
  writeFile(root, 'node_modules/ignored.js', 'ignored');
  const c = contract(external, { outputs: [{ root: external, class: 'ephemeral-evidence', tracked: false }] });
  const contractPath = path.join(external, 'contract.json');
  const outPath = path.join(external, 'before.json');
  fs.writeFileSync(contractPath, JSON.stringify(c, null, 2));
  const result = checker.createSnapshot({ root, contractPath, outPath });
  assert.equal(result.snapshot.files['public/ok.js'].sha256, sha256('ok'));
  assert.equal(result.snapshot.files['node_modules/ignored.js'], undefined);
  assert.equal(fs.existsSync(outPath), true);
  assert.equal(fs.existsSync(path.join(root, 'before.json')), false);
});

test('placement analysis allows registered homes and reports new root/public maintenance violations', () => {
  const p = policy();
  const result = checker.analyzePaths([
    'public/js/demo/index.js',
    'tests/demo/index.test.cjs',
    'public/debug.js',
    'public/maintenance-tool.js',
    'debug.js',
    'new-root/thing.js'
  ], p, { treeSha: SHA_B });
  const paths = result.findings.map((f) => f.path);
  assert.ok(paths.includes('debug.js'));
  assert.ok(paths.includes('new-root/thing.js'));
  assert.ok(paths.includes('public/debug.js'));
  assert.ok(paths.includes('public/maintenance-tool.js'));
  assert.equal(paths.includes('public/js/demo/index.js'), false);
  assert.equal(paths.includes('tests/demo/index.test.cjs'), false);
});

test('served public root entries require exact registration while nested runtime homes remain valid', () => {
  const unregistered = checker.analyzePaths(['public/foo.js'], policy({ registeredRootEntries: [] }), { treeSha: SHA_B });
  assert.ok(unregistered.findings.some((finding) => finding.ruleId === 'R1.PUBLIC_ROOT_ENTRY' && finding.path === 'public/foo.js'));

  const registered = checker.analyzePaths(['public/foo.js'], policy({ registeredRootEntries: ['public/foo.js'] }), { treeSha: SHA_B });
  assert.equal(registered.findings.length, 0, JSON.stringify(registered.findings));
});

test('public nested runtime content rejects Python, PowerShell, and batch operator scripts', () => {
  const paths = [
    'public/database/new/generate.py',
    'public/database/new/deploy.ps1',
    'public/database/new/build.bat',
    'public/js/feature/index.js'
  ];
  const result = checker.analyzePaths(paths, policy(), { treeSha: SHA_B });
  for (const pathName of paths.slice(0, 3)) assert.ok(result.findings.some((finding) => finding.ruleId === 'R1.PUBLIC_OPERATOR_SCRIPT' && finding.path === pathName));
  assert.equal(result.findings.some((finding) => finding.path === 'public/js/feature/index.js'), false);
});

function exceptionFor(finding, overrides = {}) {
  return {
    ruleId: finding.ruleId,
    path: finding.path,
    condition: finding.condition,
    edge: finding.edge,
    owner: 'fixture-governance-owner',
    rationale: 'Synthetic exception used to exercise exact STR-01 matching.',
    evidence: 'external-review/fixture-evidence.json',
    approval: 'fixture-approval-2026-09-07',
    reviewDate: '2099-01-01',
    expires: '2099-01-01',
    ...overrides
  };
}

test('valid exceptions match only the exact current finding and produce review notices', () => {
  const findings = checker.analyzePaths(['debug.js', 'maintenance.js'], policy(), { treeSha: SHA_B }).findings;
  const exact = findings.find((finding) => finding.path === 'debug.js');
  const other = findings.find((finding) => finding.path === 'maintenance.js');
  const exception = exceptionFor(exact);
  assert.equal(checker.validatePolicy(policy({ exceptions: [exception] })).ok, true);
  const comparison = checker.compareFindings({ findings: [] }, { findings }, { schemaVersion: 1, adoptionSha: ADOPTION, findings: [] }, { exceptions: [exception] });
  assert.ok(comparison.notices.some((notice) => notice.type === 'exception' && notice.finding.path === exact.path));
  assert.equal(comparison.blocking.some((finding) => finding.path === exact.path), false);
  assert.ok(comparison.blocking.some((finding) => finding.path === other.path));
});

test('unchanged expired exceptions triage without blocking unrelated new findings', () => {
  const findings = checker.analyzePaths(['debug.js', 'maintenance.js'], policy(), { treeSha: SHA_B }).findings;
  const existing = findings.find((finding) => finding.path === 'debug.js');
  const unrelated = findings.find((finding) => finding.path === 'maintenance.js');
  const expired = exceptionFor(existing, { expires: '2000-01-01' });
  const comparison = checker.compareFindings({ findings: [existing] }, { findings: [existing, unrelated] }, { schemaVersion: 1, adoptionSha: ADOPTION, findings: [] }, { exceptions: [expired] });
  assert.ok(comparison.notices.some((notice) => notice.type === 'exception-triage' && notice.finding.path === existing.path));
  assert.equal(comparison.blocking.some((finding) => finding.path === existing.path), false);
  assert.ok(comparison.blocking.some((finding) => finding.path === unrelated.path));
});

test('new or expanded expired exceptions block inferred changes without trusting an expanded flag', () => {
  const existing = checker.analyzePaths(['debug.js'], policy(), { treeSha: SHA_B }).findings[0];
  const expired = exceptionFor(existing, { expires: '2000-01-01' });
  const newlyAdded = checker.compareFindings({ findings: [] }, { findings: [existing] }, { schemaVersion: 1, adoptionSha: ADOPTION, findings: [] }, { exceptions: [expired] });
  assert.ok(newlyAdded.blocking.some((finding) => finding.ruleId === 'GOVERNANCE.EXPIRED_EXCEPTION' && finding.path === existing.path));
  const expanded = checker.compareFindings({ findings: [existing] }, { findings: [existing] }, { schemaVersion: 1, adoptionSha: ADOPTION, findings: [] }, { exceptions: [expired], scopePaths: [existing.path] });
  assert.ok(expanded.blocking.some((finding) => finding.ruleId === 'GOVERNANCE.EXPIRED_EXCEPTION' && finding.path === existing.path));
});

test('exception wildcards and incomplete metadata are rejected', () => {
  const finding = checker.analyzePaths(['debug.js'], policy(), { treeSha: SHA_B }).findings[0];
  const valid = exceptionFor(finding);
  const invalid = [
    { label: 'wildcard path', override: { path: 'public/*.js' } },
    { label: 'missing owner', override: { owner: '' } },
    { label: 'unassigned owner', override: { owner: 'unassigned' } },
    { label: 'missing evidence', override: { evidence: '' } },
    { label: 'missing approval', override: { approval: '' } },
    { label: 'missing review date', override: { reviewDate: '' } },
    { label: 'invalid expiry', override: { expires: 'not-a-date' } }
  ];
  for (const { label, override } of invalid) assert.equal(checker.validatePolicy(policy({ exceptions: [{ ...valid, ...override }] })).ok, false, label);
});

test('a removed or fixed current finding with a baseline entry requires cleanup', () => {
  const finding = checker.analyzePaths(['debug.js'], policy(), { treeSha: SHA_B }).findings[0];
  const baseLine = { schemaVersion: 1, adoptionSha: ADOPTION, findings: [checker.toBaselineEntry(finding)] };
  const comparison = checker.compareFindings({ findings: [finding] }, { findings: [] }, baseLine, { adoptionSha: ADOPTION, scopePaths: [finding.path] });
  assert.ok(comparison.actionable.some((entry) => entry.path === finding.path && /stale baseline entry requires cleanup/i.test(entry.message)));
});

test('finite baseline fingerprints grandfather unchanged findings but flag new, moved, and stale entries', () => {
  const p = policy();
  const old = checker.analyzePaths(['debug.js'], p, { treeSha: ADOPTION }).findings[0];
  const baseline = { schemaVersion: 1, adoptionSha: ADOPTION, findings: [checker.toBaselineEntry(old)] };
  const unchanged = checker.compareFindings({ findings: [old] }, { findings: [old] }, baseline, { adoptionSha: ADOPTION });
  assert.equal(unchanged.blocking.length, 0);
  assert.ok(unchanged.notices.some((n) => /legacy|baseline/i.test(n.message)));
  const fresh = checker.analyzePaths(['debug.js', 'new-root/new.js'], p, { treeSha: SHA_B });
  const freshComparison = checker.compareFindings({ findings: [old] }, fresh, baseline, { adoptionSha: ADOPTION });
  assert.ok(freshComparison.blocking.some((f) => f.path === 'new-root/new.js'));
  const moved = checker.analyzePaths(['new-root/debug.js'], p, { treeSha: SHA_B });
  assert.ok(checker.compareFindings({ findings: [old] }, moved, baseline, { adoptionSha: ADOPTION }).blocking.some((f) => f.path === 'new-root/debug.js'));
  const stale = checker.compareFindings({ findings: [] }, { findings: [] }, baseline, { adoptionSha: ADOPTION });
  assert.ok(stale.actionable.some((f) => f.path === old.path));
});

test('policy widening and a new baseline entry require governance review and cannot self-grandfather', () => {
  const oldPolicy = policy();
  const widened = policy({ supportedRoots: [...oldPolicy.supportedRoots, 'new-root'] });
  const governance = checker.compareGovernance(oldPolicy, widened, policy(), policy(), {
    baseSha: SHA_A,
    candidateSha: SHA_B,
    changedPaths: ['scripts/structure/policy.json'],
    affectedPaths: ['new-root/created.js']
  });
  assert.equal(governance.ok, false);
  assert.ok(governance.notices.some((n) => /governance review/i.test(n.message)));
  const oldFinding = checker.analyzePaths(['debug.js'], oldPolicy, { treeSha: ADOPTION }).findings[0];
  const baseline = { schemaVersion: 1, adoptionSha: ADOPTION, findings: [checker.toBaselineEntry(oldFinding)] };
  const candidate = checker.analyzePaths(['new-root/created.js'], widened, { treeSha: SHA_B });
  const comparison = checker.compareFindings({ findings: [] }, candidate, baseline, { adoptionSha: ADOPTION, baselineChanged: true });
  assert.ok(governance.blocking.some((f) => f.path === 'new-root/created.js'));
  assert.equal(comparison.blocking.some((f) => f.path === 'new-root/created.js'), false);
});

test('declared simple command target and effects are checked without executing the command', () => {
  const p = policy({ commands: [{ name: 'bad', program: 'node', args: ['scripts/missing.js'], target: 'scripts/missing.js', effects: ['remote-write'] }] });
  const result = checker.validateCommands(p, ['scripts/demo.js']);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => /command|target/i.test(f.ruleId + f.message)));
  const good = checker.validateCommands(policy(), ['scripts/demo.js']);
  assert.equal(good.ok, true);
});

test('generated family checker validates byte identity and named semantic identity in array order', () => {
  const family = {
    id: 'pair',
    source: ['scripts/data/a.json'],
    outputs: ['functions/src/data/a.json'],
    comparisonMode: 'byte-identical',
    owner: 'unassigned',
    generator: 'scripts/sync.js'
  };
  assert.equal(checker.compareGeneratedFamily(family, {
    'scripts/data/a.json': Buffer.from('[1,2]'),
    'functions/src/data/a.json': Buffer.from('[1,2]')
  }).ok, true);
  assert.equal(checker.compareGeneratedFamily(family, {
    'scripts/data/a.json': Buffer.from('[1,2]'),
    'functions/src/data/a.json': Buffer.from('[2,1]')
  }).ok, false);
  const semantic = { ...family, comparisonMode: 'ordered-json-array' };
  assert.equal(checker.compareGeneratedFamily(semantic, {
    'scripts/data/a.json': Buffer.from('[1,2]\n'),
    'functions/src/data/a.json': Buffer.from('[1,2]')
  }).ok, true);
  assert.equal(checker.compareGeneratedFamily(semantic, {
    'scripts/data/a.json': Buffer.from('[1,2]'),
    'functions/src/data/a.json': Buffer.from('[2,1]')
  }).ok, false);
});

test('local completion reports unexpected ignored/public output and honors preexisting unrelated files', () => {
  const root = tempDir();
  const external = tempDir();
  initGit(root);
  writeFile(root, 'public/ok.js', 'ok');
  writeFile(root, 'unrelated-before.log', 'before');
  const baseSha = commitGit(root, ['public/ok.js', 'unrelated-before.log']);
  const c = contract(external, {
    baseSha,
    changes: { create: ['public/ok.js'], modify: [], delete: [], rename: [] },
    outputs: [{ root: external, class: 'ephemeral-evidence', tracked: false }]
  });
  const beforeFiles = {
    'unrelated-before.log': { size: 6, mtimeMs: 1, sha256: sha256('before') }
  };
  writeFile(root, 'public/new-output.json', 'output');
  const result = checker.checkLocal({
    root,
    contract: c,
    snapshot: snapshot(root, c, beforeFiles),
    policy: policy(),
    currentFiles: {
      'public/ok.js': Buffer.from('ok'),
      'unrelated-before.log': Buffer.from('before'),
      'public/new-output.json': Buffer.from('output')
    },
    trackedPaths: ['public/ok.js'],
    treeSha: SHA_B
  });
  assert.ok(result.blocking.some((f) => f.path === 'public/new-output.json'));
  assert.equal(result.blocking.some((f) => f.path === 'unrelated-before.log'), false);
});

test('controlled output validation rejects repository paths and symlink/junction escapes', () => {
  const root = tempDir();
  const external = tempDir();
  assert.equal(checker.validateOutputDestination(external, root).ok, true);
  assert.equal(checker.validateOutputDestination(path.join(root, 'outputs'), root).ok, false);
  const link = path.join(external, 'link');
  try { fs.symlinkSync(root, link, 'junction'); } catch { return; }
  assert.equal(checker.validateOutputDestination(link, root).ok, false);
});

test('CI tree mode reports declaration and output history as not evaluated', () => {
  const result = checker.makeCiReport({
    baseSha: SHA_A,
    headSha: SHA_B,
    findings: [],
    notices: []
  });
  assert.equal(result.analysis.contractSnapshot.status, 'not-evaluated');
  assert.equal(result.analysis.outputHistory.status, 'not-evaluated');
});

test('release identity helper rejects ref mismatch, extra/missing/tampered bytes, and LFS pointers', () => {
  const file = Buffer.from('hydrated media');
  const expected = {
    sha: SHA_A,
    files: { 'public/audio/a.wav': sha256(file) },
    requiredHydrated: ['public/audio/a.wav']
  };
  const ok = checker.verifyReleaseIdentity(expected, { sourceSha: SHA_A, files: { 'public/audio/a.wav': file } });
  assert.equal(ok.ok, true);
  assert.equal(checker.verifyReleaseIdentity(expected, { sourceSha: SHA_B, files: { 'public/audio/a.wav': file } }).ok, false);
  assert.equal(checker.verifyReleaseIdentity(expected, { sourceSha: SHA_A, files: { 'public/audio/a.wav': file, 'extra': Buffer.from('x') } }).ok, false);
  assert.equal(checker.verifyReleaseIdentity(expected, { sourceSha: SHA_A, files: {} }).ok, false);
  assert.equal(checker.verifyReleaseIdentity(expected, { sourceSha: SHA_A, files: { 'public/audio/a.wav': Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n') } }).ok, false);
  assert.equal(checker.verifyReleaseIdentity({ sha: 'invalid', files: expected.files }, { sourceSha: SHA_A, files: { 'public/audio/a.wav': file } }).ok, false);
  assert.equal(checker.verifyReleaseIdentity({ sha: SHA_A, files: { 'Public/audio/a.wav': sha256(file) }, requiredHydrated: ['Public/audio/a.wav'] }, { sourceSha: SHA_A, files: { 'public/audio/a.wav': file } }).ok, false);
  assert.equal(checker.verifyReleaseIdentity({ sha: SHA_A, files: {}, requiredHydrated: ['public/audio/a.wav'] }, { sourceSha: SHA_A, files: {} }).ok, false);
});

test('CLI validates local inputs and returns documented exit codes', () => {
  const root = tempDir();
  const external = tempDir();
  initGit(root);
  const contractPath = path.join(external, 'contract.json');
  const snapshotPath = path.join(external, 'before.json');
  const c = contract(external);
  fs.writeFileSync(contractPath, JSON.stringify(c, null, 2));
  const script = path.resolve(__dirname, '../../scripts/structure/check.cjs');
  const missing = spawnSync(process.execPath, [script, 'check', '--base', SHA_A, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  const snap = spawnSync(process.execPath, [script, 'snapshot', '--contract', contractPath, '--out', snapshotPath], { cwd: root, encoding: 'utf8' });
  assert.equal(snap.status, 0, snap.stderr);
  assert.equal(fs.existsSync(snapshotPath), true);
});

test('placement analysis classifies nested dependencies and cache artifacts', () => {
  const result = checker.analyzePaths([
    'node_modules/pkg/index.js',
    'node_modules/pkg/nested/deep.js',
    '.cache/build.json',
    '__pycache__/module.pyc',
    'public/maintenance.js'
  ], policy(), { treeSha: SHA_B });
  const byRule = new Map(result.findings.map((finding) => [finding.path, finding.ruleId]));
  assert.equal(byRule.get('node_modules/pkg/index.js'), 'R4.TRACKED_DEPENDENCY');
  assert.equal(byRule.get('node_modules/pkg/nested/deep.js'), 'R4.TRACKED_DEPENDENCY');
  assert.equal(byRule.get('.cache/build.json'), 'R4.TRACKED_CACHE');
  assert.equal(byRule.get('__pycache__/module.pyc'), 'R4.TRACKED_CACHE');
  assert.equal(byRule.get('public/maintenance.js'), 'R1.PUBLIC_MAINTENANCE');
});

test('CLI rejects malformed policy schemas and unsupported comparison modes with exit 2', () => {
  const malformed = [
    ['domains', { domains: [{ id: 'missing-roots' }] }, /domains require/],
    ['rootEntries', { rootEntries: [{}] }, /rootEntries require/],
    ['artifactClasses', { artifactClasses: [] }, /artifactClasses/],
    ['generated-family', { generatedFamilies: [{ id: 'bad', generator: 'scripts/gen.js', owner: 'fixture', comparisonPairs: [{ source: 'a', outputs: ['b'], comparisonMode: 'typo' }] }] }, /invalid comparison pair/]
  ];
  for (const [label, override, message] of malformed) {
    const root = validFixture();
    const baseSha = commitAll(root, `${label} base`);
    writeFile(root, 'scripts/structure/policy.json', `${JSON.stringify(policy(override), null, 2)}\n`);
    const headSha = commitAll(root, `${label} malformed`);
    const result = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
    assert.equal(result.status, 2, `${label}: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, message, label);
  }
});

test('fixed adoption SHA is enforced in CI and local completion modes', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'adoption enforcement base');
  const external = externalContractAndSnapshot(root, baseSha);
  writeFile(root, 'scripts/structure/policy.json', `${JSON.stringify(policy({ adoptionSha: SHA_A }), null, 2)}\n`);
  const headSha = commitAll(root, 'changed adoption SHA');
  const ci = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
  assert.equal(ci.status, 2, ci.stdout);
  assert.match(ci.stdout, /adoptionSha/i);
  const full = runCli(root, ['check', '--ci', '--full', '--head', headSha, '--json']);
  assert.equal(full.status, 2, full.stdout);
  assert.match(full.stdout, /adoptionSha/i);
  const local = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(local.status, 2, local.stdout);
  assert.match(local.stdout, /adoptionSha/i);
});

test('CI compares committed candidate trees and ignores dirty worktree files', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'CI base');
  writeFile(root, 'public/new-mode.js', 'window.newMode = true;\n');
  const cleanHead = commitAll(root, 'CI clean candidate');
  const clean = runCli(root, ['check', '--ci', '--base', baseSha, '--head', cleanHead, '--json']);
  assert.equal(clean.status, 0, clean.stdout);

  writeFile(root, 'debug.js', 'dirty only; must not be read from the worktree\n');
  const dirty = runCli(root, ['check', '--ci', '--base', baseSha, '--head', cleanHead, '--json']);
  assert.equal(dirty.status, 0, dirty.stdout);
  assert.doesNotMatch(dirty.stdout, /debug\.js/);

  writeFile(root, 'public/debug.js', 'committed maintenance script\n');
  writeFile(root, '.cache/build.json', '{}\n');
  writeFile(root, 'node_modules/pkg/fresh.js', 'tracked dependency\n');
  writeFile(root, 'new-root/file.js', 'unsupported root\n');
  const violatingHead = commitAll(root, 'CI committed violations');
  const violating = runCli(root, ['check', '--ci', '--base', cleanHead, '--head', violatingHead, '--json']);
  assert.equal(violating.status, 1, violating.stdout);
  for (const expectedPath of ['public/debug.js', '.cache/build.json', 'node_modules/pkg/fresh.js', 'new-root/file.js']) assert.match(violating.stdout, new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('historical adoption rejects a same-commit baseline entry for a new violation', () => {
  const root = tempDir();
  initGit(root);
  addAdoptionAlternate(root);
  writeFile(root, 'README.md', '# historical fixture\n');
  const baseSha = commitAll(root, 'pre-governance tree');
  const finding = { fingerprint: 'R1.ROOT_ENTRY|debug.js||unregistered root file|1' };
  writeGovernanceFixture(root, { baseline: baseline([finding]) });
  writeFile(root, 'debug.js', 'new root violation\n');
  const headSha = commitAll(root, 'attempt baseline self-grandfathering');
  const result = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /baseline entry cannot self-grandfather/);
  assert.match(result.stdout, /debug\.js/);
});

test('CI rejects malformed, unavailable and missing non-full base references with exit 2', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'base reference fixture');
  const malformed = runCli(root, ['check', '--ci', '--base', 'not-a-sha', '--head', baseSha, '--json']);
  assert.equal(malformed.status, 2, malformed.stdout);
  const unavailable = runCli(root, ['check', '--ci', '--base', '1'.repeat(40), '--head', baseSha, '--json']);
  assert.equal(unavailable.status, 2, unavailable.stdout);
  const missing = runCli(root, ['check', '--ci', '--head', baseSha, '--json']);
  assert.equal(missing.status, 2, missing.stdout);
});

test('CI full mode resolves HEAD when --head is omitted', () => {
  const root = validFixture();
  const headSha = commitAll(root, 'full mode HEAD fixture');
  const result = runCli(root, ['check', '--ci', '--full', '--json']);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.full, true);
  assert.equal(result.report.head, headSha);
  assert.equal(result.report.base, null);
});

test('CI full mode preserves actual adoption npm scripts as unchanged legacy notices', () => {
  const root = validFixture();
  const adoptionPackage = JSON.parse(git(root, ['show', `${ADOPTION}:package.json`]).stdout.toString('utf8'));
  assert.ok(Object.keys(adoptionPackage.scripts || {}).length >= 90, 'fixture must exercise the real adoption script surface');
  writeFile(root, 'package.json', `${JSON.stringify({ ...adoptionPackage, scripts: { ...adoptionPackage.scripts, demo: 'node scripts/demo.js' } }, null, 2)}\n`);
  const headSha = commitAll(root, 'full mode adoption package fixture');

  const explicit = runCli(root, ['check', '--ci', '--full', '--head', headSha, '--json']);
  assert.equal(explicit.status, 0, explicit.stdout);
  assert.ok(explicit.report.notices.some((notice) => notice.type === 'command-scope' && notice.path === 'package.json'));

  const implicit = runCli(root, ['check', '--ci', '--full', '--json']);
  assert.equal(implicit.status, 0, implicit.stdout);
  assert.equal(implicit.report.head, headSha);
  assert.ok(implicit.report.notices.some((notice) => notice.type === 'command-scope' && notice.path === 'package.json'));
});

test('registering a new public root entry requires governance review', () => {
  const basePolicy = policy({ registeredRootEntries: [] });
  const candidatePolicy = policy({ registeredRootEntries: ['public/new-mode.js'] });
  const helper = checker.compareGovernance(basePolicy, candidatePolicy, baseline(), baseline(), {
    baseSha: SHA_A,
    candidateSha: SHA_B,
    changedPaths: ['scripts/structure/policy.json'],
    affectedPaths: ['public/new-mode.js']
  });
  assert.equal(helper.ok, false, JSON.stringify(helper));
  assert.match(JSON.stringify(helper), /governance|coverage|registeredRootEntries/i);

  const root = validFixture({ policy: basePolicy });
  const baseSha = commitAll(root, 'public registration base');
  writeFile(root, 'public/new-mode.js', 'window.newMode = true;\n');
  writeFile(root, 'scripts/structure/policy.json', `${JSON.stringify(candidatePolicy, null, 2)}\n`);
  const headSha = commitAll(root, 'public registration candidate');
  const result = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /governance|coverage|new-mode/i);
});

test('release manifests require hydrated listed files and a typed hydration list', () => {
  const file = Buffer.from('approved release file');
  const expected = {
    sha: SHA_A,
    files: { 'public/a.txt': sha256(file) },
    requiredHydrated: ['public/absent.wav']
  };
  const missingRequired = checker.verifyReleaseIdentity(expected, { sourceSha: SHA_A, files: { 'public/a.txt': file } });
  assert.equal(missingRequired.ok, false);
  assert.ok(missingRequired.blocking.some((finding) => ['R8.FILE_SET', 'R8.FILE_MISSING', 'R8.HYDRATED_MANIFEST'].includes(finding.ruleId)));
  const invalidType = checker.verifyReleaseIdentity({ ...expected, requiredHydrated: 'public/a.txt' }, { sourceSha: SHA_A, files: { 'public/a.txt': file } });
  assert.equal(invalidType.ok, false);
  const invalidList = checker.verifyReleaseIdentity({ ...expected, requiredHydrated: ['public/a.txt', 42] }, { sourceSha: SHA_A, files: { 'public/a.txt': file } });
  assert.equal(invalidList.ok, false);
});

test('CI blocks an expired exception when the same finding changes in place', () => {
  const basePolicy = policy();
  const finding = checker.analyzePaths(['debug.js'], basePolicy, { treeSha: SHA_A }).findings[0];
  const expiredPolicy = policy({ exceptions: [exceptionFor(finding, { expires: '2000-01-01' })] });
  const root = validFixture({ policy: expiredPolicy });
  writeFile(root, 'debug.js', 'original legacy finding\n');
  const baseSha = commitAll(root, 'expired exception base');
  writeFile(root, 'debug.js', 'modified legacy finding\n');
  const headSha = commitAll(root, 'expired exception changed finding');
  const result = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /GOVERNANCE\.EXPIRED_EXCEPTION|expired exception/i);
});

test('local declared edits preserve an unchanged historical finding, while a reintroduced finding fails', () => {
  const p = policy();
  const legacyPath = 'debug_can.py';
  const finding = checker.analyzePaths([legacyPath], p, { treeSha: ADOPTION }).findings[0];
  const root = validFixture({ policy: p, baseline: baseline([checker.toBaselineEntry(finding)]) });
  writeFile(root, legacyPath, 'legacy content before local edit\n');
  const baseSha = commitAll(root, 'historical baseline local fixture');
  const external = externalContractAndSnapshot(root, baseSha, {
    changes: { create: ['new-root/reintroduced.js'], modify: [legacyPath], delete: [], rename: [] }
  });
  writeFile(root, legacyPath, 'legacy content after declared local edit\n');
  const unchanged = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(unchanged.status, 0, unchanged.stdout);
  assert.match(unchanged.stdout, /legacy|baseline/i);

  writeFile(root, 'new-root/reintroduced.js', 'new unsupported root violation\n');
  const reintroduced = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(reintroduced.status, 1, reintroduced.stdout);
  assert.match(reintroduced.stdout, /reintroduced|unsupported|new policy violation/i);
});

test('local completion rejects a baseline entry for a file introduced after fixed adoption', () => {
  const p = policy();
  const legacyPath = 'new-root/post-adoption.js';
  const finding = checker.analyzePaths([legacyPath], p, { treeSha: SHA_B }).findings[0];
  const root = validFixture({ policy: p, baseline: baseline() });
  writeFile(root, legacyPath, 'post-adoption file before local edit\n');
  const baseSha = commitAll(root, 'post-adoption local fixture');
  const external = externalContractAndSnapshot(root, baseSha, {
    changes: { create: [], modify: ['scripts/structure/legacy-baseline.json', legacyPath], delete: [], rename: [] }
  });
  writeFile(root, 'scripts/structure/legacy-baseline.json', `${JSON.stringify(baseline([checker.toBaselineEntry(finding)]), null, 2)}\n`);
  writeFile(root, legacyPath, 'post-adoption file after local edit\n');
  const result = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /BASELINE\.REPRODUCTION|fixed adoption|post-adoption/i);
  assert.match(result.stdout, /post-adoption\.js/);
});

test('CI catches changed policy command targets and package script targets', () => {
  const policyRoot = validFixture();
  const policyBase = commitAll(policyRoot, 'command policy base');
  const changedPolicy = policy({ commands: [{ name: 'demo', program: 'node', args: ['scripts/missing.js'], target: 'scripts/missing.js', effects: ['local-write'] }] });
  writeFile(policyRoot, 'scripts/structure/policy.json', `${JSON.stringify(changedPolicy, null, 2)}\n`);
  const policyHead = commitAll(policyRoot, 'missing policy target');
  const policyResult = runCli(policyRoot, ['check', '--ci', '--base', policyBase, '--head', policyHead, '--json']);
  assert.equal(policyResult.status, 1, policyResult.stdout);
  assert.match(policyResult.stdout, /R5\.COMMAND_TARGET/);

  const packageRoot = validFixture();
  const packageBase = commitAll(packageRoot, 'package command base');
  writeFile(packageRoot, 'package.json', `${JSON.stringify({ name: 'str01-fixture', scripts: { demo: 'node scripts/missing.js' } }, null, 2)}\n`);
  const packageHead = commitAll(packageRoot, 'missing package script target');
  const packageResult = runCli(packageRoot, ['check', '--ci', '--base', packageBase, '--head', packageHead, '--json']);
  assert.equal(packageResult.status, 1, packageResult.stdout);
  assert.match(packageResult.stdout, /R5\.PACKAGE_COMMAND/);
});

test('CI catches newly added and changed undeclared package scripts', () => {
  const addedRoot = validFixture();
  const addedBase = commitAll(addedRoot, 'package script declaration base');
  writeFile(addedRoot, 'scripts/fresh.js', "'use strict';\n");
  writeFile(addedRoot, 'package.json', `${JSON.stringify({ name: 'str01-fixture', scripts: { demo: 'node scripts/demo.js', fresh: 'node scripts/fresh.js' } }, null, 2)}\n`);
  const addedHead = commitAll(addedRoot, 'new undeclared package script');
  const addedResult = runCli(addedRoot, ['check', '--ci', '--base', addedBase, '--head', addedHead, '--json']);
  assert.equal(addedResult.status, 1, addedResult.stdout);
  assert.match(addedResult.stdout, /fresh|R5\.PACKAGE/i);

  const changedRoot = validFixture();
  writeFile(changedRoot, 'scripts/legacy.js', "'use strict';\n");
  writeFile(changedRoot, 'package.json', `${JSON.stringify({ name: 'str01-fixture', scripts: { demo: 'node scripts/demo.js', legacy: 'node scripts/legacy.js' } }, null, 2)}\n`);
  const changedBase = commitAll(changedRoot, 'legacy package script base');
  writeFile(changedRoot, 'scripts/other.js', "'use strict';\n");
  writeFile(changedRoot, 'package.json', `${JSON.stringify({ name: 'str01-fixture', scripts: { demo: 'node scripts/demo.js', legacy: 'node scripts/other.js' } }, null, 2)}\n`);
  const changedHead = commitAll(changedRoot, 'changed undeclared package script');
  const changedResult = runCli(changedRoot, ['check', '--ci', '--base', changedBase, '--head', changedHead, '--json']);
  assert.equal(changedResult.status, 1, changedResult.stdout);
  assert.match(changedResult.stdout, /legacy|R5\.PACKAGE/i);
});

test('removing dependency artifact coverage cannot admit a fresh nested dependency', () => {
  const basePolicy = policy({ supportedRoots: [...policy().supportedRoots, 'node_modules'] });
  const root = validFixture({ policy: basePolicy });
  const baseSha = commitAll(root, 'dependency coverage base');
  const narrowed = policy({
    supportedRoots: basePolicy.supportedRoots,
    artifactClasses: { ...basePolicy.artifactClasses, dependency: [] }
  });
  writeFile(root, 'scripts/structure/policy.json', `${JSON.stringify(narrowed, null, 2)}\n`);
  writeFile(root, 'node_modules/fresh.js', 'new tracked dependency\n');
  const headSha = commitAll(root, 'narrow dependency coverage');
  const result = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /node_modules[\\/]fresh\.js|artifact|coverage|governance/i);
});

test('checker-only edits require governance review', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'checker governance base');
  writeFile(root, 'scripts/structure/check.cjs', "'use strict';\n// synthetic checker edit\n");
  const headSha = commitAll(root, 'checker-only edit');
  const result = runCli(root, ['check', '--ci', '--base', baseSha, '--head', headSha, '--json']);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.governance.status, 'review-required', result.stdout);
  assert.match(result.stdout, /checker|governance/i);
});

test('local completion validates repository identity and external snapshot scope', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'identity source');
  const external = externalContractAndSnapshot(root, baseSha);
  const clone = path.join(tempDir(), 'clone');
  const cloneResult = spawnSync('git', ['clone', '--quiet', root, clone], { encoding: 'utf8' });
  assert.equal(cloneResult.status, 0, cloneResult.stderr);
  const mismatch = runCli(clone, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(mismatch.status, 2, mismatch.stdout);
  assert.match(mismatch.stdout, /snapshot root does not match|repository root/i);
  const insideOutput = path.join(root, 'test-results', 'inside.json');
  const c = contract(insideOutput, { baseSha });
  assert.equal(checker.validateContract(c, { repositoryRoot: root }).ok, false);
});

test('local completion detects ignored public output and staged-only undeclared edits', () => {
  const root = validFixture();
  writeFile(root, '.gitignore', 'public/new-output.json\n');
  const baseSha = commitAll(root, 'local output base');
  const external = externalContractAndSnapshot(root, baseSha);
  writeFile(root, 'public/new-output.json', 'ignored output\n');
  const ignored = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(ignored.status, 1, ignored.stdout);
  assert.match(ignored.stdout, /public[\\/]new-output\.json/);

  const stagedRoot = validFixture();
  const stagedBase = commitAll(stagedRoot, 'staged base');
  const stagedExternal = externalContractAndSnapshot(stagedRoot, stagedBase);
  writeFile(stagedRoot, 'public/ok.js', 'staged but restored\n');
  git(stagedRoot, ['add', 'public/ok.js']);
  git(stagedRoot, ['checkout', '--', 'public/ok.js']);
  const staged = runCli(stagedRoot, ['check', '--base', stagedBase, '--contract', stagedExternal.contractPath, '--snapshot', stagedExternal.snapshotPath, '--json']);
  assert.equal(staged.status, 1, staged.stdout);
  assert.match(staged.stdout, /public[\\/]ok\.js/);
});

test('index-only additions are not silently omitted from local completion', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'index-only base');
  const external = externalContractAndSnapshot(root, baseSha);
  writeFile(root, 'public/staged-only.js', 'index only\n');
  git(root, ['add', 'public/staged-only.js']);
  fs.unlinkSync(path.join(root, 'public', 'staged-only.js'));
  const result = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /staged-only\.js/);
});

test('mixed index cleanup audits retained dependency and removed cache while rejecting a force-added dependency', () => {
  const dependencyPath = 'node_modules/legacy-dependency/index.js';
  const cachePath = '.cache/legacy-build.json';
  const newDependencyPath = 'node_modules/newly-forbidden.js';
  const p = policy();
  const historicalFindings = checker.analyzePaths([dependencyPath, cachePath], p, { treeSha: ADOPTION }).findings;
  const root = validFixture({ policy: p, baseline: baseline(historicalFindings.map((finding) => checker.toBaselineEntry(finding))) });
  writeFile(root, dependencyPath, 'legacy dependency retained on disk\n');
  writeFile(root, cachePath, 'legacy cache\n');
  const baseSha = commitAll(root, 'mixed index cleanup base');
  const external = externalContractAndSnapshot(root, baseSha, {
    changes: { create: [newDependencyPath], modify: ['scripts/structure/legacy-baseline.json'], delete: [dependencyPath, cachePath], rename: [] }
  });

  writeFile(root, 'scripts/structure/legacy-baseline.json', `${JSON.stringify(baseline(), null, 2)}\n`);
  git(root, ['add', 'scripts/structure/legacy-baseline.json']);
  git(root, ['rm', '--cached', '--quiet', '--', dependencyPath]);
  git(root, ['rm', '--quiet', '--', cachePath]);
  const cleanup = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(cleanup.status, 0, cleanup.stdout);
  assert.ok(cleanup.report.analysis.scannedPaths.includes(dependencyPath), cleanup.stdout);
  assert.ok(cleanup.report.analysis.scannedPaths.includes(cachePath), cleanup.stdout);
  assert.equal(cleanup.report.analysis.index.status, 'evaluated');

  writeFile(root, newDependencyPath, 'new forbidden dependency\n');
  git(root, ['add', '--force', '--', newDependencyPath]);
  const negative = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(negative.status, 1, negative.stdout);
  assert.ok(negative.report.blocking.some((finding) => finding.ruleId === 'R4.TRACKED_DEPENDENCY' && finding.path === newDependencyPath), negative.stdout);
  assert.equal(negative.report.blocking.some((finding) => finding.ruleId === 'R1.UNDECLARED_CHANGE' && finding.path === newDependencyPath), false, negative.stdout);
});

test('pre-existing staged state is captured without being discarded by snapshot', () => {
  const root = validFixture();
  const baseSha = commitAll(root, 'pre-staged base');
  writeFile(root, 'public/pre-staged.js', 'already staged before snapshot\n');
  git(root, ['add', 'public/pre-staged.js']);
  const beforeStatus = git(root, ['status', '--porcelain=v1']).stdout;
  assert.match(beforeStatus, /A\s+public[\\/]pre-staged\.js/);
  const external = externalContractAndSnapshot(root, baseSha);
  const snapshotValue = JSON.parse(fs.readFileSync(external.snapshotPath, 'utf8'));
  assert.match(snapshotValue.gitStatus, /A\s+public[\\/]pre-staged\.js/);
  assert.equal(git(root, ['status', '--porcelain=v1']).stdout, beforeStatus);
  const result = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(result.status, 0, result.stdout);
});

test('staged rename status records both old and new paths', () => {
  const root = validFixture();
  writeFile(root, 'public/rename-old.js', 'rename fixture\n');
  const baseSha = commitAll(root, 'rename base');
  const external = externalContractAndSnapshot(root, baseSha);
  git(root, ['mv', 'public/rename-old.js', 'public/rename-new.js']);
  const result = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /rename-old\.js/);
  assert.match(result.stdout, /rename-new\.js/);
});

test('new junctions are surfaced as undeclared links', (t) => {
  const root = validFixture();
  const baseSha = commitAll(root, 'link base');
  const external = externalContractAndSnapshot(root, baseSha);
  const link = path.join(root, 'linked-public');
  try { fs.symlinkSync(path.join(root, 'public'), link, 'junction'); } catch (error) { t.skip(`junction unavailable: ${error.message}`); return; }
  const result = runCli(root, ['check', '--base', baseSha, '--contract', external.contractPath, '--snapshot', external.snapshotPath, '--json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /linked-public|link/i);
});

test('generated canonical and output pairs recompute cleanly and reject tampering', () => {
  const family = {
    id: 'segmentation-study',
    generator: 'scripts/sync.js',
    owner: 'fixture-owner',
    comparisonPairs: [{ source: 'scripts/data/segmentation.json', outputs: ['functions/src/data/segmentation.json'], comparisonMode: 'byte-identical' }],
    canonicalInputs: ['scripts/data/segmentation.json'],
    requiredOutputs: ['functions/src/data/segmentation.json']
  };
  const same = { 'scripts/data/segmentation.json': Buffer.from('{"rows":[1,2]}\n'), 'functions/src/data/segmentation.json': Buffer.from('{"rows":[1,2]}\n') };
  assert.equal(checker.compareGeneratedFamily(family, same).ok, true);
  const tampered = { ...same, 'functions/src/data/segmentation.json': Buffer.from('{"rows":[1,3]}\n') };
  const mismatch = checker.compareGeneratedFamily(family, tampered);
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.findings.some((finding) => finding.ruleId === 'R3.FAMILY_MISMATCH'));
  const missing = checker.compareGeneratedFamily(family, { 'scripts/data/segmentation.json': same['scripts/data/segmentation.json'] });
  assert.equal(missing.ok, false);
  assert.ok(missing.findings.some((finding) => /MISSING/.test(finding.ruleId)));
});
