'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NODE = process.execPath;
const SELECTOR = path.join(REPO_ROOT, 'scripts', 'crm', 'verification-selection.cjs');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'crm', 'verify-crm-suite.js');
const PHASE_ROOT = process.env.STR02A_TEST_ROOT || path.join(os.tmpdir(), 'cursor-ai-str02a-b7c0-20260907-0947', 'fixtures');

const CRM_ROOTS = [
  'public/js/crm',
  'functions/src/routes/admin',
  'functions/src/crm'
];
const EXPECTED_LEGACY_CHECK_COUNT = 66;
// Added in 58b1a2c19e39ed3b48cd48fd2fb252bec63aec7f after the frozen baseline.
const EXPECTED_EXISTING_ADDITIONAL_CHECKS = [
  ['node', ['tests/crm/enrollment-1on1-scheduling.test.js']],
  ['node', ['tests/crm/student-route-deep-link.test.js']],
  ['node', ['tests/crm/scheduling-service.test.js']]
];
const EXPECTED_CURRENT_CHECK_COUNT = EXPECTED_LEGACY_CHECK_COUNT + EXPECTED_EXISTING_ADDITIONAL_CHECKS.length;
const APPROVED_ADDITIONAL_LINT_GLOBS = [
  'functions/src/routes/crm/**/*.{js,cjs,mjs}',
  'services/crm-voice-relay/**/*.{js,cjs,mjs}'
];
const EXPECTED_RECURSIVE_LINT_GLOBS = [
  'public/js/crm/**/*.{js,cjs,mjs}',
  'functions/src/routes/admin/**/*.{js,cjs,mjs}',
  'functions/src/crm/**/*.{js,cjs,mjs}',
  ...APPROVED_ADDITIONAL_LINT_GLOBS
];
const EXPECTED_COMPOSED_LEGACY_SHA256 = '035be88a01e6f3b2e4ceb6b59730b52a199de7bd50ff4ae26944905fd26bc394';

function mkdirp(root, relative) {
  const target = path.join(root, relative);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function write(root, relative, contents = '') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function fixture({ feature = true, sentinel = false } = {}) {
  fs.mkdirSync(PHASE_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(PHASE_ROOT, 'selection-'));
  for (const crmRoot of CRM_ROOTS) mkdirp(root, crmRoot);
  mkdirp(root, 'tests/crm/selection');

  const unitPath = 'tests/crm/selection/orders.test.cjs';
  const sentinelPath = path.join(root, 'executed.sentinel');
  const unitBody = sentinel
    ? `require('node:fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'executed');\n`
    : 'process.exitCode = 0;\n';
  write(root, unitPath, unitBody);
  write(root, 'public/js/crm/orders.js', 'module.exports = {};\n');
  write(root, 'functions/src/routes/admin/orders.cjs', 'module.exports = {};\n');
  write(root, 'functions/src/crm/orders.mjs', 'export {};\n');

  const registry = feature
    ? {
        schemaVersion: 1,
        features: [{
          id: 'orders',
          sourceRoots: [...CRM_ROOTS],
          testRoot: 'tests/crm/selection',
          unitTests: [unitPath]
        }]
      }
    : { schemaVersion: 1, features: [] };
  const registryPath = write(root, 'scripts/crm/verification-selection.json', `${JSON.stringify(registry, null, 2)}\n`);
  return { root, registry, registryPath, unitPath, sentinelPath };
}

function runNode(script, args, options = {}) {
  const result = spawnSync(NODE, [script, ...args], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env }
  });
  return {
    ...result,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runSelector(args, options = {}) {
  return runNode(SELECTOR, args, options);
}

function runRunner(args, options = {}) {
  return runNode(RUNNER, args, options);
}

function jsonOutput(result) {
  assert.equal(result.stderr.trim(), '', `unexpected stderr:\n${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`expected JSON stdout, got exit ${result.status}: ${result.stdout}\n${result.stderr}\n${error.message}`);
  }
}

function diagnostic(result, message = 'expected a diagnostic') {
  assert.notEqual(result.status, 0, message);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /selection|registry|test|path|root|duplicate|unknown|invalid|outside|symlink|overlap/i, message);
  return output;
}

function loadSelector() {
  assert.ok(fs.existsSync(SELECTOR), `missing selector module: ${SELECTOR}`);
  return require(SELECTOR);
}

function loadRunner() {
  assert.ok(fs.existsSync(RUNNER), `missing runner module: ${RUNNER}`);
  return require(RUNNER);
}

function validationFailure(fn, pattern = /invalid|selection|registry|path|test/i) {
  let thrown = null;
  let result;
  try {
    result = fn();
  } catch (error) {
    thrown = error;
  }
  if (!thrown && result && result.ok !== false && !result.error && !result.errors) {
    assert.fail('expected validation to fail');
  }
  const message = thrown ? String(thrown.message || thrown) : JSON.stringify(result);
  assert.match(message, pattern);
  return message;
}

function assertSelectionShape(selection) {
  assert.ok(selection && typeof selection === 'object');
  assert.ok(Array.isArray(selection.unitTests), 'selection must expose unitTests');
  assert.ok(Array.isArray(selection.features) || Array.isArray(selection.entries) || selection.registry, 'selection must retain validated feature selection');
}

function normalizeChecks(checks) {
  return checks.map((check) => {
    if (Array.isArray(check)) return check;
    return [check.command, check.args];
  });
}

function checksHash(checks) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizeChecks(checks))).digest('hex');
}

test('selector exports the bounded public API and accepts a complete fixture registry', () => {
  const { root, registry, registryPath } = fixture();
  const selector = loadSelector();
  for (const name of ['CRM_SOURCE_ROOTS', 'validateRegistry', 'inventoryUnitTests', 'selectUnitTests', 'checkSelection']) {
    assert.equal(typeof selector[name] === 'function' || name === 'CRM_SOURCE_ROOTS', true, `${name} is not exported`);
  }
  assert.deepEqual(selector.CRM_SOURCE_ROOTS, CRM_ROOTS);
  const validated = selector.validateRegistry(registry, { root });
  assert.ok(validated);
  const selection = selector.selectUnitTests({ root, registryPath, registry });
  assertSelectionShape(selection);
  assert.deepEqual(selection.unitTests, ['tests/crm/selection/orders.test.cjs']);
});

test('selector inventories a registered nested unit-test path under a direct dedicated test root', () => {
  const base = fixture({ feature: false });
  const nestedPath = 'tests/crm/selection/nested/orders.test.mjs';
  fs.rmSync(path.join(base.root, base.unitPath));
  write(base.root, nestedPath, 'export {};\n');
  const registry = {
    schemaVersion: 1,
    features: [{
      id: 'nested-orders',
      sourceRoots: ['public/js/crm'],
      testRoot: 'tests/crm/selection',
      unitTests: [nestedPath]
    }]
  };
  const selector = loadSelector();
  const selection = selector.selectUnitTests({ root: base.root, registry, registryPath: base.registryPath });
  assert.equal(selection.ok, true, JSON.stringify(selection));
  assert.deepEqual(selection.unitTests, [nestedPath]);
});

test('selector check validates explicit registration without executing a matching test', () => {
  const fixtureState = fixture({ sentinel: true });
  const result = runSelector(['check', '--root', fixtureState.root, '--registry', fixtureState.registryPath]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(fixtureState.sentinelPath), false, 'selector check executed a registered test');
});

test('selector list is inspectable and also never executes fixture tests', () => {
  const fixtureState = fixture({ sentinel: true });
  const result = runSelector(['--list', '--root', fixtureState.root, '--registry', fixtureState.registryPath]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const listed = jsonOutput(result);
  assert.deepEqual(listed.unitTests, ['tests/crm/selection/orders.test.cjs']);
  assert.equal(fs.existsSync(fixtureState.sentinelPath), false, 'selector list executed a registered test');
});

test('selector rejects unknown fields, malformed roots, traversal, case drift, overlap, and unsupported extensions', () => {
  const base = fixture();
  const selector = loadSelector();
  const cases = [
    ['unknown feature field', { ...base.registry, features: [{ ...base.registry.features[0], owner: 'not-a-policy-field' }] }, /unknown|field/],
    ['wrong source root', { ...base.registry, features: [{ ...base.registry.features[0], sourceRoots: ['public'] }] }, /root|source/],
    ['test root traversal', { ...base.registry, features: [{ ...base.registry.features[0], testRoot: 'tests/crm/../browser' }] }, /path|root|outside|travers/],
    ['case mismatch', { ...base.registry, features: [{ ...base.registry.features[0], sourceRoots: ['Public/js/crm', ...CRM_ROOTS.slice(1)] }] }, /case|root|path/],
    ['overlapping test roots', { ...base.registry, features: [base.registry.features[0], { ...base.registry.features[0], id: 'nested', testRoot: 'tests/crm/selection/nested', unitTests: [base.unitPath] }] }, /overlap|root/],
    ['unsupported unit extension', { ...base.registry, features: [{ ...base.registry.features[0], unitTests: ['tests/crm/selection/orders.txt'] }] }, /extension|test|path/]
  ];
  for (const [label, registry, pattern] of cases) {
    validationFailure(() => selector.validateRegistry(registry, { root: base.root }), pattern);
    const registryPath = write(base.root, `scripts/crm/${label.replace(/[^a-z0-9]+/gi, '-')}.json`, `${JSON.stringify(registry)}\n`);
    diagnostic(runSelector(['check', '--root', base.root, '--registry', registryPath]), `CLI accepted ${label}`);
  }
});

test('selector rejects missing, duplicate, outside, and unregistered unit tests', () => {
  const base = fixture();
  const selector = loadSelector();
  const scenarios = [
    ['missing declared test', { ...base.registry, features: [{ ...base.registry.features[0], unitTests: ['tests/crm/selection/missing.test.cjs'] }] }, /missing|test/],
    ['duplicate declared test', { ...base.registry, features: [{ ...base.registry.features[0], unitTests: [base.unitPath, base.unitPath] }] }, /duplicate|test/],
    ['outside own root', { ...base.registry, features: [{ ...base.registry.features[0], unitTests: ['tests/crm/outside.test.cjs'] }] }, /outside|root|test/],
    ['unregistered matching test', base.registry, /unregistered|register|test/]
  ];
  write(base.root, 'tests/crm/selection/extra.test.js', 'process.exitCode = 0;\n');
  for (const [label, registry, pattern] of scenarios) {
    validationFailure(() => selector.selectUnitTests({ root: base.root, registryPath: base.registryPath, registry }), pattern);
    const registryPath = write(base.root, `scripts/crm/${label.replace(/[^a-z0-9]+/gi, '-')}.json`, `${JSON.stringify(registry)}\n`);
    diagnostic(runSelector(['check', '--root', base.root, '--registry', registryPath]), `CLI accepted ${label}`);
  }
});

test('selector rejects a symlinked approved source root', () => {
  const base = fixture({ feature: false });
  const linkPath = path.join(base.root, 'public/js/crm/link');
  try {
    fs.symlinkSync(path.join(base.root, 'functions/src/crm'), linkPath, 'junction');
  } catch (error) {
    assert.fail(`test environment cannot create a temporary junction: ${error.message}`);
  }
  const registry = {
    schemaVersion: 1,
    features: [{
      id: 'linked',
      sourceRoots: ['public/js/crm/link'],
      testRoot: 'tests/crm/selection',
      unitTests: [base.unitPath]
    }]
  };
  const selector = loadSelector();
  validationFailure(() => selector.validateRegistry(registry, { root: base.root }), /symlink|junction|link/i);
});

test('selector does not scan tests outside registered test roots', () => {
  const base = fixture({ feature: false });
  write(base.root, 'tests/crm/legacy/browser-looking.test.js', 'throw new Error("must not execute");\n');
  const selector = loadSelector();
  const selection = selector.selectUnitTests({ root: base.root, registryPath: base.registryPath, registry: base.registry });
  assert.deepEqual(selection.unitTests, []);
  const listed = jsonOutput(runSelector(['--list', '--root', base.root, '--registry', base.registryPath]));
  assert.deepEqual(listed.unitTests, []);
});

test('runner list preserves the frozen baseline, existing scheduling additions and approved lint roots', () => {
  const base = fixture({ feature: false });
  const result = runRunner(['--list', '--root', base.root, '--registry', base.registryPath]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const listed = jsonOutput(result);
  assert.ok(Array.isArray(listed.checks));
  assert.deepEqual(listed.unitTests, []);
  assert.equal(listed.checks.length, EXPECTED_CURRENT_CHECK_COUNT);
  const checks = normalizeChecks(listed.checks);
  assert.equal(checks.at(-1)[0], 'eslint');
  assert.deepEqual(checks.at(-1)[1], [
    'public/crm-admin.js',
    'public/js/classroom-api.js',
    ...EXPECTED_RECURSIVE_LINT_GLOBS,
    'src/routes/admin.js',
    '--quiet'
  ]);
  assert.deepEqual(checks.slice(10, 13), EXPECTED_EXISTING_ADDITIONAL_CHECKS);
  assert.equal(checks.filter(([command]) => command !== 'eslint').length, 68);
  // Remove only the exact existing scheduling slice and approved lint additions
  // before comparing the original frozen hash, including all 65 original nonlint checks.
  const legacyChecks = [...checks.slice(0, 10), ...checks.slice(13)].map(([command, args]) => [command, command === 'eslint'
    ? args.filter(arg => !APPROVED_ADDITIONAL_LINT_GLOBS.includes(arg))
    : args]);
  assert.equal(checksHash(legacyChecks), EXPECTED_COMPOSED_LEGACY_SHA256);
});

test('runner list inserts registered unit tests by feature and path before legacy checks', () => {
  const base = fixture();
  const result = runRunner(['--list', '--root', base.root, '--registry', base.registryPath]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const listed = jsonOutput(result);
  assert.deepEqual(listed.unitTests, [base.unitPath]);
  assert.equal(listed.checks[0].kind, 'node');
  assert.equal(listed.checks[0].command, 'node');
  assert.deepEqual(listed.checks[0].args, [base.unitPath]);
  assert.equal(listed.checks.filter((check) => check.command === 'node' && check.args?.join(' ') === base.unitPath).length, 1);
  assert.equal(listed.checks.length, EXPECTED_CURRENT_CHECK_COUNT + 1);
});

test('runner lint list is exactly the selection gate plus one ESLint check', () => {
  const base = fixture({ feature: false });
  const result = runRunner(['--list', '--lint', '--root', base.root, '--registry', base.registryPath]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const listed = jsonOutput(result);
  assert.deepEqual(listed.unitTests, []);
  assert.equal(listed.checks.length, 1);
  assert.equal(listed.checks[0].kind, 'eslint');
  assert.equal(listed.checks[0].command, 'eslint');
  assert.deepEqual(listed.checks[0].args, [
    'public/crm-admin.js',
    'public/js/classroom-api.js',
    ...EXPECTED_RECURSIVE_LINT_GLOBS,
    'src/routes/admin.js',
    '--quiet'
  ]);
});

test('runner list does not spawn a sentinel unit or resolve an execution override', () => {
  const base = fixture({ sentinel: true });
  const listed = runRunner(['--list', '--root', base.root, '--registry', base.registryPath]);
  assert.equal(listed.status, 0, `${listed.stdout}\n${listed.stderr}`);
  assert.equal(fs.existsSync(base.sentinelPath), false);
  const execution = runRunner(['--root', base.root, '--registry', base.registryPath]);
  diagnostic(execution, 'runner accepted fixture-root execution mode');
  assert.equal(fs.existsSync(base.sentinelPath), false, 'execution override spawned a fixture test');
});

test('runner composition and executor preserve order and stop at the first failure', () => {
  const base = fixture();
  const runner = loadRunner();
  assert.equal(typeof runner.composeChecks, 'function');
  assert.equal(typeof runner.runChecks, 'function');
  const selector = loadSelector();
  const selection = selector.selectUnitTests({ root: base.root, registryPath: base.registryPath, registry: base.registry });
  const checks = runner.composeChecks({ root: base.root, selection, lintOnly: false });
  assert.ok(checks.length >= 2);
  const firstArgs = Array.isArray(checks[0]) ? checks[0][1] : checks[0].args;
  assert.deepEqual(firstArgs, [base.unitPath]);
  const allSeen = [];
  runner.runChecks({
    checks,
    executor: (kind, args) => {
      allSeen.push([kind, [...args]]);
      return 0;
    }
  });
  assert.deepEqual(allSeen, normalizeChecks(checks), 'executor did not receive the composed check list');
  const seen = [];
  assert.throws(() => runner.runChecks({
    checks: checks.slice(0, 3),
    executor: (kind, args) => {
      seen.push([kind, args]);
      return seen.length === 1 ? 17 : 0;
    }
  }), /failed|17|status|exit/i);
  assert.equal(seen.length, 1, 'executor continued after first failed check');
});

test('lint selection validates before the local ESLint stub and then runs only ESLint', () => {
  const invalid = fixture({ feature: false, sentinel: true });
  const invalidLintSentinel = path.join(invalid.root, 'eslint.sentinel');
  const stubName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
  const stubBody = process.platform === 'win32'
    ? `@echo off\r\necho eslint>${invalidLintSentinel}\r\nexit /b 0\r\n`
    : `#!/bin/sh\nprintf 'eslint\\n' >> ${JSON.stringify(invalidLintSentinel)}\nexit 0\n`;
  const stub = write(invalid.root, `node_modules/.bin/${stubName}`, stubBody);
  if (process.platform !== 'win32') fs.chmodSync(stub, 0o755);
  assert.ok(fs.existsSync(stub));
  const invalidRegistry = { schemaVersion: 1, features: [{ id: 'bad', sourceRoots: ['public/js/crm'], testRoot: 'tests/crm/selection', unitTests: ['tests/crm/selection/missing.test.cjs'] }] };
  write(invalid.root, 'scripts/crm/verification-selection.json', `${JSON.stringify(invalidRegistry)}\n`);
  const rejected = runRunner(['--lint'], { cwd: invalid.root });
  diagnostic(rejected, 'lint runner accepted an invalid registry');
  assert.equal(fs.existsSync(invalid.sentinelPath), false, 'ESLint ran before selection validation');
  assert.equal(fs.existsSync(invalidLintSentinel), false, 'ESLint fallback ran after selection validation failed');

  const valid = fixture({ sentinel: true });
  const validLintSentinel = path.join(valid.root, 'eslint.sentinel');
  const validStubBody = process.platform === 'win32'
    ? `@echo off\r\necho eslint>${validLintSentinel}\r\nexit /b 0\r\n`
    : `#!/bin/sh\nprintf 'eslint\\n' >> ${JSON.stringify(validLintSentinel)}\nexit 0\n`;
  const validStub = write(valid.root, `node_modules/.bin/${stubName}`, validStubBody);
  if (process.platform !== 'win32') fs.chmodSync(validStub, 0o755);
  const accepted = runRunner(['--lint'], { cwd: valid.root });
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  assert.equal(fs.existsSync(valid.sentinelPath), false, 'registered unit test ran during lint-only mode');
  assert.equal(fs.readFileSync(validLintSentinel, 'utf8').trim(), 'eslint');
  assert.equal(fs.readFileSync(validLintSentinel, 'utf8').trim().split(/\r?\n/).length, 1, 'lint-only mode ran more than one check');
});

test('external ESLint sees nested js/cjs/mjs CRM files while honoring ignored files', async () => {
  const eslintPath = process.env.TEST_ESLINT_PATH || path.join(REPO_ROOT, 'node_modules', 'eslint');
  assert.ok(fs.existsSync(eslintPath), `ESLint installation is unavailable: ${eslintPath}`);
  const base = fixture({ feature: false });
  write(base.root, '.eslintrc.json', JSON.stringify({ env: { es2022: true, node: true }, ignorePatterns: ['**/ignored.js'] }));
  const files = [
    'public/js/crm/nested/feature.js',
    'public/js/crm/nested/feature.cjs',
    'public/js/crm/nested/feature.mjs',
    'functions/src/routes/admin/nested/feature.js',
    'functions/src/routes/admin/nested/feature.cjs',
    'functions/src/routes/admin/nested/feature.mjs',
    'functions/src/crm/nested/feature.js',
    'functions/src/crm/nested/feature.cjs',
    'functions/src/crm/nested/feature.mjs',
    'functions/src/routes/crm/nested/feature.js',
    'functions/src/routes/crm/nested/feature.cjs',
    'functions/src/routes/crm/nested/feature.mjs',
    'services/crm-voice-relay/nested/feature.js',
    'services/crm-voice-relay/nested/feature.cjs',
    'services/crm-voice-relay/nested/feature.mjs',
    'public/js/crm/nested/ignored.js',
    'functions/src/routes/crm/nested/ignored.js',
    'services/crm-voice-relay/nested/ignored.js'
  ];
  for (const relative of ['public/js/crm/orders.js', 'functions/src/routes/admin/orders.cjs', 'functions/src/crm/orders.mjs']) {
    fs.rmSync(path.join(base.root, relative));
  }
  for (const relative of files) write(base.root, relative, 'const selected = true;\nmodule.exports = selected;\n');
  const eslintPackage = fs.statSync(eslintPath).isDirectory() ? eslintPath : path.dirname(path.dirname(eslintPath));
  const { ESLint } = require(path.join(eslintPackage, 'lib', 'api.js'));
  const linter = new ESLint({ cwd: base.root });
  const results = await linter.lintFiles(EXPECTED_RECURSIVE_LINT_GLOBS);
  const selected = results.map((result) => path.relative(base.root, result.filePath).replaceAll(path.sep, '/')).sort();
  const expected = files.filter((relative) => !relative.endsWith('/ignored.js')).sort();
  assert.deepEqual(selected, expected);
});

test('runner rejects a registered test that is already in the explicit legacy list', () => {
  const base = fixture();
  const runner = loadRunner();
  assert.throws(
    () => runner.composeChecks({
      root: base.root,
      selection: { ok: true, unitTests: ['tests/crm/admin-router-contract.test.js'], features: [] },
      lintOnly: false
    }),
    /duplicate|already|explicit/i
  );
  assert.throws(
    () => runner.composeChecks({
      root: base.root,
      selection: { ok: true, unitTests: ['tests/crm/admin-router-contract.test.js'], features: [] },
      lintOnly: true
    }),
    /duplicate|already|explicit/i
  );
});
