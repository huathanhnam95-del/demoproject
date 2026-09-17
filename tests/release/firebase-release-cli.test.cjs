'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const CONTROLLER_SOURCE = path.join(REPOSITORY_ROOT, 'scripts/release/firebase-release.cjs');
const NODE_EXE = process.env.STR03A_NODE_PATH || process.execPath;
const PHASE_ROOT = path.resolve(
  process.env.STR03A_TEST_ROOT || path.join(os.tmpdir(), 'cursor-ai-str03a-b7c0-20260907-1013', 'release-cli-tests')
);
const FIXED_SENTINEL = 'str03a-private-inherited-sentinel';
const PRIVATE_VALUE = 'synthetic-private-setting-never-published';

fs.mkdirSync(PHASE_ROOT, { recursive: true });

function makeTempDirectory(prefix) {
  return fs.mkdtempSync(path.join(PHASE_ROOT, `${prefix}-`));
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function createValidSegmentationManifest() {
  const entries = [];
  let index = 0;
  for (const syllableCount of [2, 3, 4, 5]) {
    const developmentCount = syllableCount < 4 ? 18 : 17;
    for (let item = 0; item < 25; item += 1) {
      index += 1;
      const labels = Array.from({ length: syllableCount }, (_, position) => `a${syllableCount}${position}`);
      entries.push({
        taskId: `segmentation-study-v2-${String(index).padStart(3, '0')}`,
        targetWord: `fixtureword${index}`,
        targetSyllableCount: syllableCount,
        referenceIpa: labels.join(''),
        referenceSyllableIpa: labels,
        split: item < developmentCount ? 'development' : 'holdout',
        dialect: 'en-US',
        referenceDialect: 'en-US',
        referenceProvenance: { dialect: 'en-US', method: 'explicit-reviewed-en-US-v1' },
        referenceLabelProvenance: 'explicit-reviewed-en-US-v1',
        labelProvenance: 'explicit-reviewed-en-US-v1',
        exceptionRationale: 'Synthetic deterministic fixture for release contract tests.'
      });
    }
  }
  const manifest = { studyId: 'segmentation-study-v2', version: '2.0.0', entries };
  manifest.manifestSha256 = sha256(JSON.stringify(canonicalJson(manifest)));
  return manifest;
}

function runGit(cwd, args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }).trim();
}

function runGitWithInput(cwd, args, input) {
  const result = spawnSync('git', ['--no-optional-locks', ...args], {
    cwd,
    input,
    encoding: 'utf8',
    windowsHide: true,
    shell: false
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function tarHasPaxPath(tarPath, expectedPath) {
  const archive = fs.readFileSync(tarPath);
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? parseInt(sizeText, 8) : 0;
    const type = String.fromCharCode(header[156] || 48);
    const payloadStart = offset + 512;
    if (type === 'x' || type === 'g') {
      const payload = archive.subarray(payloadStart, payloadStart + size).toString('utf8');
      if (payload.includes(`path=${expectedPath}\n`)) return true;
    }
    offset = payloadStart + size + ((512 - (size % 512)) % 512);
  }
  return false;
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function parseFinalJsonLine(text, label) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length, `${label} should produce output`);
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch (error) {
    assert.fail(`${label} did not end with JSON: ${error.message}`);
  }
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function createGeneratorScripts(root) {
  writeText(path.join(root, 'scripts/sync-version.js'), String.raw`
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const timestamp = args[args.indexOf('--timestamp') + 1] || null;
if (!timestamp) throw new Error('fixture version sync requires --timestamp');
if (process.env.RELEASE_PREP_LOG) {
  fs.appendFileSync(process.env.RELEASE_PREP_LOG, JSON.stringify({ kind: 'version', timestamp }) + '\n');
}
`);
  writeText(path.join(root, 'scripts/read-aloud/build-connected-speech-index.js'), String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
if (!value('--public-index')) {
  if (process.env.RELEASE_PREP_LOG) fs.appendFileSync(process.env.RELEASE_PREP_LOG, JSON.stringify({ kind: 'legacy-connectedSpeech' }) + '\n');
  process.exit(0);
}
const generatedAt = value('--timestamp');
const publicIndex = value('--public-index');
const featuredPrompts = value('--featured-prompts');
const functionsIndex = value('--functions-index');
const coverageDir = value('--coverage-dir');
if (!generatedAt || !publicIndex || !featuredPrompts || !functionsIndex || !coverageDir) throw new Error('fixture connected speech output arguments are incomplete');
const workbook = value('--workbook');
const audioManifest = value('--audio-manifest');
if (!workbook || !audioManifest) throw new Error('fixture connected speech input arguments are incomplete');
const index = { version: 1, generatedAt, inputs: { workbookSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(workbook)).digest('hex'), audioManifestSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(audioManifest)).digest('hex') }, prompts: [{ questionId: 'fixture-a', text: 'A deterministic fixture.' }] };
const featured = { version: '1', updatedAt: generatedAt, families: { fixture: ['fixture-a'] }, subtypes: { fixture: ['fixture-a'] } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8'); };
write(publicIndex, index);
write(functionsIndex, index);
write(featuredPrompts, featured);
fs.mkdirSync(coverageDir, { recursive: true });
write(path.join(coverageDir, 'coverage.json'), { generatedAt, promptCount: 1, promptsWithSampleAudio: 1 });
fs.writeFileSync(path.join(coverageDir, 'summary.md'), '# Fixture coverage\n\nGenerated at ' + generatedAt + '.\n', 'utf8');
if (process.env.RELEASE_PREP_LOG) fs.appendFileSync(process.env.RELEASE_PREP_LOG, JSON.stringify({ kind: 'connectedSpeech', generatedAt }) + '\n');
`);
  writeText(path.join(root, 'scripts/segmentation-study/sync-manifest.js'), String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const destination = args[args.indexOf('--destination') + 1] || null;
if (!destination) {
  if (process.env.RELEASE_PREP_LOG) fs.appendFileSync(process.env.RELEASE_PREP_LOG, JSON.stringify({ kind: 'legacy-segmentationV2' }) + '\n');
  process.exit(0);
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify({ version: 'v2', prompts: [{ id: 'fixture-a' }] }, null, 2) + '\n', 'utf8');
if (process.env.RELEASE_PREP_LOG) fs.appendFileSync(process.env.RELEASE_PREP_LOG, JSON.stringify({ kind: 'segmentationV2' }) + '\n');
`);
}

function createFakeFirebaseCli(root) {
  const packageRoot = path.join(root, 'fake-firebase-tools');
  writeJson(path.join(packageRoot, 'package.json'), {
    name: 'firebase-tools',
    version: '15.29.0',
    main: 'lib/bin/firebase.js',
    bin: { firebase: 'lib/bin/firebase.js' }
  });
  writeText(path.join(packageRoot, 'lib/configstore.js'), String.raw`
'use strict';
const path = require('node:path');
module.exports = { configstore: {
  get(key) {
    if (key !== 'activeProjects') throw new Error('fixture configstore only supports activeProjects');
    if (process.env.FAKE_CONFIGSTORE_MUST_NOT_LOAD === '1') throw new Error('explicit project must not load configstore');
    return { [path.resolve(process.env.FAKE_SOURCE_ROOT)]: 'default' };
  }
} };
`);
  writeText(path.join(packageRoot, 'lib/bin/firebase.js'), String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const candidateRoot = process.env.BEL_FIREBASE_RELEASE_CANDIDATE_ROOT;
if (!candidateRoot || args[0] !== 'deploy') throw new Error('fixture publisher received an invalid invocation');
const configPath = value('--config');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const selectors = String(value('--only') || '').split(',');
const publishesHosting = selectors.includes('hosting');
const publishesFunctions = selectors.includes('functions') || selectors.some((selector) => selector.startsWith('functions:'));
const hookCalls = [];
const invokeHooks = (product, commands) => {
  if (!Array.isArray(commands)) return;
  for (const command of commands) {
    const match = String(command).match(/(?:^|\s)--product\s+([a-z]+)/i);
    const hookProduct = match ? match[1].toLowerCase() : product;
    if (hookProduct !== product || !['hosting', 'functions'].includes(hookProduct)) throw new Error('fixture predeploy hook has an invalid product');
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const resourceDir = path.join(candidateRoot, hookProduct === 'functions' ? 'functions' : 'public');
      const hookEnv = {
        ...process.env,
        PROJECT_DIR: candidateRoot,
        RESOURCE_DIR: resourceDir,
        GCLOUD_PROJECT: process.env.FAKE_PROJECT_ID || value('--project')
      };
      const hookScript = path.join(candidateRoot, 'scripts', 'release', 'firebase-release.cjs');
      const result = require('node:child_process').spawnSync(process.execPath, [hookScript, 'hook', '--product', hookProduct, '--json'], {
        cwd: candidateRoot,
        env: hookEnv,
        encoding: 'utf8',
        windowsHide: true,
        shell: false
      });
      if (result.error || result.status !== 0) {
        process.stderr.write(String(result.stderr || result.stdout || result.error || 'fixture predeploy hook failed'));
        process.exit(31);
      }
      hookCalls.push({ product: hookProduct });
    }
  }
};
if (publishesHosting) invokeHooks('hosting', config.hosting && config.hosting.predeploy);
if (publishesFunctions) invokeHooks('functions', config.functions && config.functions[0] && config.functions[0].predeploy);
const markerPath = path.join(candidateRoot, 'public', 'source-marker.txt');
const dotenvPath = path.join(candidateRoot, 'functions', '.env.demo-project');
const dotenvBytes = fs.existsSync(dotenvPath) ? fs.readFileSync(dotenvPath) : null;
const log = {
  command: process.execPath,
  argv: args,
  cwd: process.cwd(),
  project: value('--project'),
  selector: value('--only'),
  candidateRoot,
  sourceMarker: publishesHosting && fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : null,
  functionsIgnore: config.functions && config.functions[0] && config.functions[0].ignore,
  hostingPredeploy: config.hosting && config.hosting.predeploy,
  functionsPredeploy: config.functions && config.functions[0] && config.functions[0].predeploy,
  dotenvPresent: Boolean(dotenvBytes),
  dotenvMatchesExpected: Boolean(dotenvBytes && dotenvBytes.equals(Buffer.from('PRIVATE_SETTING=synthetic-private-setting-never-published\n'))),
  inheritedSentinelSeen: process.env.STR03A_INHERITED_SENTINEL === 'str03a-private-inherited-sentinel',
  hookCalls
};
if (process.env.FAKE_PUBLISH_LOG) fs.appendFileSync(process.env.FAKE_PUBLISH_LOG, JSON.stringify(log) + '\n', 'utf8');
process.stdout.write('fixture firebase publisher accepted\n');
`);
  return {
    packageRoot,
    entrypoint: path.join(packageRoot, 'lib/bin/firebase.js'),
    configstore: path.join(packageRoot, 'lib/configstore.js')
  };
}

function createFakeNpm(root) {
  const entrypoint = path.join(root, 'fake-npm.js');
  writeText(entrypoint, String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  if (process.env.FAKE_NPM_LOG) fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n', 'utf8');
  process.stdout.write('10.9.3\n');
  process.exit(0);
}
if (process.env.FAKE_NPM_LOG) {
  fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n', 'utf8');
}
if (process.env.FAKE_NPM_CREATE_DOTGIT === '1' && args[0] === 'ci' && path.basename(process.cwd()) === 'functions') {
  const metadataPath = path.join(process.cwd(), 'node_modules', 'fixture-dependency', '.git', 'metadata');
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, 'synthetic dependency metadata\n', 'utf8');
}
process.exit(0);
`);
  return entrypoint;
}

function createFixture() {
  const root = makeTempDirectory('source');
  const externalRoot = makeTempDirectory('external');
  const fakeCli = createFakeFirebaseCli(externalRoot);
  const fakeNpm = createFakeNpm(externalRoot);
  fs.mkdirSync(path.join(root, 'scripts/release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public/database/RA/Voice/audio'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public/js'), { recursive: true });
  fs.mkdirSync(path.join(root, 'functions/src/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/structure'), { recursive: true });
  fs.copyFileSync(CONTROLLER_SOURCE, path.join(root, 'scripts/release/firebase-release.cjs'));
  writeJson(path.join(root, 'package.json'), {
    name: 'str03a-release-fixture',
    version: '1.2.3',
    scripts: {
      deploy: 'node scripts/release/firebase-release.cjs hosting',
      'deploy:full': 'node scripts/release/firebase-release.cjs full'
    }
  });
  writeJson(path.join(root, 'functions/package.json'), {
    name: 'str03a-release-functions-fixture',
    version: '1.0.0',
    scripts: { deploy: 'node ../scripts/release/firebase-release.cjs functions' },
    main: 'src/index.js',
    engines: { node: '22' }
  });
  writeJson(path.join(root, 'package-lock.json'), {
    name: 'str03a-release-fixture', version: '1.2.3', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'str03a-release-fixture', version: '1.2.3' } }
  });
  writeJson(path.join(root, 'functions/package-lock.json'), {
    name: 'str03a-release-functions-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'str03a-release-functions-fixture', version: '1.0.0' } }
  });
  writeJson(path.join(root, 'firebase.json'), {
    functions: [{
      source: 'functions',
      codebase: 'default',
      runtime: 'nodejs22',
      ignore: ['node_modules', '.git', 'custom-private-rule'],
      predeploy: ['node scripts/release/firebase-release.cjs hook --product functions']
    }],
    hosting: {
      public: 'public',
      ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
      predeploy: ['node scripts/release/firebase-release.cjs hook --product hosting']
    },
    firestore: { rules: 'firestore.rules' }
  });
  writeJson(path.join(root, '.firebaserc'), { projects: { default: 'demo-project' } });
  writeText(path.join(root, '.gitignore'), 'functions/.env*\n');
  writeText(path.join(root, 'public/index.html'), '<!doctype html><div id="version-indicator" class="version-indicator">V1.2.3</div><script src="/read-aloud-mode.js?v=old"></script>\n');
  writeText(path.join(root, 'public/crm-admin.html'), '<!doctype html><script src="/crm-admin.js?v=20260906-v1.2.2"></script>\n');
  writeText(path.join(root, 'public/crm-entrance-test-result.html'), '<!doctype html><script src="/crm-entrance-test-result.js?v=20260906-v1.2.2"></script>\n');
  writeText(path.join(root, 'public/source-marker.txt'), 'source-A\n');
  writeText(path.join(root, 'public/database/RA/RA.xlsx'), 'synthetic workbook bytes\n');
  writeJson(path.join(root, 'public/database/RA/Voice/audio/manifest.json'), { files: [] });
  writeText(path.join(root, 'public/database/RA/connected-speech-index.json'), '{}\n');
  writeText(path.join(root, 'public/database/RA/connected-speech-featured-prompts.json'), '{}\n');
  writeText(path.join(root, 'functions/src/index.js'), 'module.exports = {};\n');
  writeText(path.join(root, 'scripts/read-aloud/connected-speech-index-core.js'), "'use strict';\nmodule.exports = {};\n");
  for (const relative of [
    'public/js/read-aloud-prompt-grammar.js',
    'public/js/read-aloud-spoken-forms.js',
    'public/js/read-aloud-connected-speech-rules.js',
    'public/js/read-aloud-linking.js'
  ]) writeText(path.join(root, relative), "'use strict';\n");
  writeJson(path.join(root, 'scripts/structure/policy.json'), { generatedFamilies: [] });
  writeText(path.join(root, 'tests/crm/crm-shell-static.test.js'), "const CRM_ADMIN_ASSET_VERSION = '20260906-v1.2.2';\n");
  writeText(path.join(root, 'GEMINI.md'), '- **Phase**: Release V1.2.3\n- **Next Version**: `V1.2.4`\n');
  writeText(path.join(root, 'firestore.rules'), 'rules_version = \'2\'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }\n');
  writeJson(path.join(root, 'functions/src/data/read-aloud-connected-speech-index.json'), {});
  writeJson(path.join(root, 'functions/src/data/segmentation-study-v2.json'), { version: 'source' });
  writeJson(path.join(root, 'scripts/data/segmentation-study-v2.json'), { version: 'source' });
  createGeneratorScripts(root);
  fs.copyFileSync(path.join(REPOSITORY_ROOT, 'scripts/sync-version.js'), path.join(root, 'scripts/sync-version.js'));
  const segmentationPath = path.join(root, 'scripts/segmentation-study/sync-manifest.js');
  const realSegmentationGenerator = fs.readFileSync(path.join(REPOSITORY_ROOT, 'scripts/segmentation-study/sync-manifest.js'), 'utf8');
  writeText(segmentationPath, [
    '(function () {',
    '  const logFile = process.env.RELEASE_PREP_LOG;',
    "  if (logFile) require('node:fs').appendFileSync(logFile, JSON.stringify({ kind: 'segmentationV2' }) + '\\n');",
    '}());',
    realSegmentationGenerator
  ].join('\n'));
  const segmentationManifest = createValidSegmentationManifest();
  writeJson(path.join(root, 'scripts/data/segmentation-study-v2.json'), segmentationManifest);
  writeJson(path.join(root, 'functions/src/data/segmentation-study-v2.json'), segmentationManifest);

  runGit(root, ['init', '--quiet', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'str03a-fixture@example.invalid']);
  runGit(root, ['config', 'user.name', 'STR03A fixture']);
  runGit(root, ['add', '--all']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture source A']);
  const sourceASha = runGit(root, ['rev-parse', 'HEAD']);
  writeText(path.join(root, 'public/source-marker.txt'), 'source-B\n');
  runGit(root, ['add', 'public/source-marker.txt']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture source B']);
  const sourceBSha = runGit(root, ['rev-parse', 'HEAD']);
  writeText(path.join(root, 'functions/.env.demo-project'), `PRIVATE_SETTING=${PRIVATE_VALUE}\n`);

  return {
    root,
    externalRoot,
    fakeCli,
    fakeNpm,
    sourceASha,
    sourceBSha,
    controller: path.join(root, 'scripts/release/firebase-release.cjs')
  };
}

function baseEnvironment(fixture, profileRoot, { expectedMarker = 'source-A', expectDotenv = false } = {}) {
  return {
    ...process.env,
    STR03A_INHERITED_SENTINEL: FIXED_SENTINEL,
    FAKE_SOURCE_ROOT: fixture.root,
    FAKE_PROJECT_ID: 'demo-project',
    FAKE_EXPECT_MARKER: expectedMarker,
    FAKE_EXPECT_DOTENV: expectDotenv ? '1' : '0',
    FAKE_PUBLISH_LOG: path.join(profileRoot, 'publisher.jsonl'),
    FAKE_NPM_LOG: path.join(profileRoot, 'npm.jsonl'),
    RELEASE_PREP_LOG: path.join(profileRoot, 'preparation.jsonl'),
    STR03A_TEST_ROOT: PHASE_ROOT.toString()
  };
}

function runChild(fixture, args, options = {}) {
  const result = spawnSync(NODE_EXE, [fixture.controller, ...args], {
    cwd: options.cwd || fixture.root,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: options.timeout || 120000
  });
  return {
    ...result,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function runRelease(fixture, profile, { sha = fixture.sourceASha, project, expectedMarker = 'source-A', environment = {} } = {}) {
  const profileRoot = path.join(fixture.externalRoot, `run-${profile}-${sha.slice(0, 8)}-${project || 'active'}`);
  fs.mkdirSync(profileRoot, { recursive: true });
  const expectDotenv = profile === 'functions' || profile === 'full';
  const args = [profile, '--sha', sha, '--firebase-cli', fixture.fakeCli.entrypoint, '--npm-cli', fixture.fakeNpm, '--external-root', profileRoot, '--json'];
  if (project) args.push('--project', project);
  const result = runChild(fixture, args, {
    env: { ...baseEnvironment(fixture, profileRoot, { expectedMarker, expectDotenv }), ...environment }
  });
  return { ...result, profileRoot, output: result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null };
}

function receiptFor(run, profile, sha) {
  const prefix = `firebase-release-${profile}-${sha.slice(0, 12)}`;
  const matches = fs.readdirSync(run.profileRoot).filter((name) => name.startsWith(prefix) && name.endsWith('.receipt.json'));
  assert.equal(matches.length, 1, `exactly one release receipt should exist for ${profile} ${sha}`);
  const receiptPath = path.join(run.profileRoot, matches[0]);
  const value = readJson(receiptPath);
  assert.equal(value.profile, profile, 'receipt profile must match the requested release profile');
  assert.equal(value.sourceSha, sha, 'receipt source must match the requested commit');
  return { path: receiptPath, value };
}

function receiptFiles(run) {
  return fs.readdirSync(run.profileRoot).filter((name) => name.endsWith('.receipt.json'));
}

function hookEnvironment(receipt) {
  const configPath = path.join(receipt.value.candidateRoot, receipt.value.project.configPath);
  return {
    BEL_FIREBASE_RELEASE_CONTEXT: '1',
    BEL_FIREBASE_RELEASE_RECEIPT: receipt.path,
    BEL_FIREBASE_RELEASE_PROFILE: receipt.value.profile,
    BEL_FIREBASE_RELEASE_CANDIDATE_ROOT: receipt.value.candidateRoot,
    BEL_FIREBASE_RELEASE_SOURCE_SHA: receipt.value.sourceSha,
    BEL_FIREBASE_RELEASE_PROJECT_ID: receipt.value.project.id,
    BEL_FIREBASE_RELEASE_PROJECT_ALIAS: receipt.value.project.alias || '',
    BEL_FIREBASE_RELEASE_CONFIG_PATH: configPath,
    BEL_FIREBASE_RELEASE_SURFACE_SHA256: sha256(JSON.stringify(receipt.value.surface))
  };
}

function jsonOutput(result) {
  assert.equal(result.status, 0, `child process failed: ${result.stderr || result.stdout}`);
  assert.ok(result.stdout.trim(), 'child process should return JSON');
  return JSON.parse(result.stdout.trim());
}

test('raw Git export handles directory, PAX/Unicode, binary, empty, executable entries and rejects links', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const unicodeDirectory = `archive-${'é'.repeat(80)}`;
  const unicodeRelative = `${unicodeDirectory}/unicode-pax.txt`;
  const executableRelative = 'scripts/archive-executable.sh';
  const binaryRelative = 'scripts/archive-binary.bin';
  const emptyRelative = 'scripts/archive-empty.txt';
  writeText(path.join(fixture.root, unicodeRelative), 'PAX Unicode archive bytes\n');
  writeText(path.join(fixture.root, executableRelative), '#!/bin/sh\nprintf archive-executable\\n\n');
  fs.writeFileSync(path.join(fixture.root, binaryRelative), Buffer.from([0x00, 0xff, 0x0a, 0x80, 0x7f, 0x00]));
  fs.writeFileSync(path.join(fixture.root, emptyRelative), Buffer.alloc(0));
  runGit(fixture.root, ['add', '--all']);
  runGit(fixture.root, ['update-index', '--chmod=+x', executableRelative]);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'archive extraction inputs']);
  const archiveSha = runGit(fixture.root, ['rev-parse', 'HEAD']);
  runGit(fixture.root, ['config', 'core.autocrlf', 'true']);
  fs.unlinkSync(path.join(fixture.root, unicodeRelative));
  runGit(fixture.root, ['checkout', '--quiet', '--', unicodeRelative]);
  const worktreeUnicodeBytes = fs.readFileSync(path.join(fixture.root, unicodeRelative));
  assert.equal(worktreeUnicodeBytes.equals(Buffer.from('PAX Unicode archive bytes\n')), false, 'autocrlf fixture must differ from canonical blob bytes in the worktree');
  assert.equal(worktreeUnicodeBytes.equals(Buffer.from('PAX Unicode archive bytes\r\n')), true, 'autocrlf fixture should expose CRLF worktree bytes');

  const tarPath = path.join(fixture.externalRoot, 'archive-input.tar');
  runGit(fixture.root, ['archive', '--format=tar', '--output', tarPath, archiveSha]);
  assert.equal(tarHasPaxPath(tarPath, unicodeRelative), true, 'long UTF-8 path should be represented by a PAX path record');
  assert.match(runGit(fixture.root, ['ls-tree', '-r', archiveSha, '--', executableRelative]), /^100755 blob [0-9a-f]{40}\t/);

  const controller = require(CONTROLLER_SOURCE);
  const candidate = controller.createCandidate({
    sourceRoot: fixture.root,
    sourceSha: archiveSha,
    externalRoot: path.join(fixture.externalRoot, 'archive-candidate')
  });
  assert.equal(fs.readFileSync(path.join(candidate.candidateRoot, unicodeRelative), 'utf8'), 'PAX Unicode archive bytes\n');
  assert.equal(fs.readFileSync(path.join(candidate.candidateRoot, executableRelative), 'utf8'), '#!/bin/sh\nprintf archive-executable\\n\n');
  assert.deepEqual(fs.readFileSync(path.join(candidate.candidateRoot, binaryRelative)), Buffer.from([0x00, 0xff, 0x0a, 0x80, 0x7f, 0x00]));
  assert.equal(fs.statSync(path.join(candidate.candidateRoot, emptyRelative)).size, 0);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(candidate.candidateRoot, executableRelative)).mode & 0o777, 0o755);

  const linkBlob = runGitWithInput(fixture.root, ['hash-object', '-w', '--stdin'], '../outside-secret');
  runGit(fixture.root, ['update-index', '--add', '--cacheinfo', `120000,${linkBlob},archive-escape-link`]);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'archive link rejection']);
  const linkSha = runGit(fixture.root, ['rev-parse', 'HEAD']);
  assert.throws(() => controller.createCandidate({
    sourceRoot: fixture.root,
    sourceSha: linkSha,
    externalRoot: path.join(fixture.externalRoot, 'archive-link-candidate')
  }), (error) => error && ['GIT_ARCHIVE_LINK', 'GIT_EXPORT_LINK', 'GIT_TREE_LINK', 'SOURCE_ENTRY'].includes(error.code));
});

test('release CLI prepares and publishes each supported profile from committed source', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const expectedSelectors = {
    hosting: 'hosting',
    functions: 'functions',
    full: 'hosting,functions:api,firestore:rules'
  };
  const expectedPreparation = {
    hosting: ['version', 'connectedSpeech'],
    functions: ['connectedSpeech', 'segmentationV2'],
    full: ['version', 'connectedSpeech', 'segmentationV2']
  };
  const expectedReceiptPreparation = {
    hosting: ['npm-version', 'npm-root', 'version', 'connectedSpeech'],
    functions: ['npm-version', 'npm-root', 'npm-functions', 'connectedSpeech', 'segmentationV2'],
    full: ['npm-version', 'npm-root', 'npm-functions', 'version', 'connectedSpeech', 'segmentationV2']
  };
  const originalFunctionsIgnore = readJson(path.join(fixture.root, 'firebase.json')).functions[0].ignore;
  for (const profile of ['hosting', 'functions', 'full']) {
    const run = runRelease(fixture, profile);
    const output = jsonOutput(run);
    assert.equal(output.ok, true);
    assert.equal(output.profile, profile);
    assert.equal(output.selector, expectedSelectors[profile]);
    assert.equal(output.sourceSha, fixture.sourceASha);
    assert.deepEqual(output.project, { id: 'demo-project', alias: 'default' });
    assert.equal(JSON.stringify(output).includes(fixture.externalRoot), false, 'public result must not disclose private candidate paths');

    const receipt = receiptFor(run, profile, fixture.sourceASha);
    assert.equal(receipt.value.sourceSha, fixture.sourceASha);
    assert.equal(receipt.value.project.id, 'demo-project');
    assert.equal(receipt.value.project.alias, 'default');
    assert.equal(receipt.value.prepared.commands.length, expectedReceiptPreparation[profile].length);
    assert.deepEqual(receipt.value.prepared.commands.map((command) => command.kind), expectedReceiptPreparation[profile]);
    assert.deepEqual(readJsonLines(path.join(run.profileRoot, 'preparation.jsonl')).map((item) => item.kind), expectedPreparation[profile].filter((kind) => kind !== 'version'));
    const npmInvocations = readJsonLines(path.join(run.profileRoot, 'npm.jsonl'));
    assert.ok(npmInvocations.some((item) => item.args.includes('--version')), 'release must verify the pinned npm CLI before preparation');
    assert.ok(npmInvocations.every((item) => {
      const cwd = path.resolve(item.cwd);
      const candidateRoot = path.resolve(receipt.value.candidateRoot);
      if (item.args.includes('--version')) return cwd === candidateRoot;
      return cwd === candidateRoot || cwd === path.join(candidateRoot, 'functions');
    }), 'npm preparation must run from the sealed candidate root or its Functions root');

    const publishers = readJsonLines(path.join(run.profileRoot, 'publisher.jsonl'));
    assert.equal(publishers.length, 1, `${profile} should publish exactly once`);
    assert.equal(publishers[0].project, 'default', 'active alias should be retained for publication');
    assert.equal(publishers[0].selector, expectedSelectors[profile]);
    assert.equal(publishers[0].sourceMarker, profile === 'functions' ? null : 'source-A\n');
    assert.equal(publishers[0].inheritedSentinelSeen, true, 'child publisher should inherit the sentinel');
    assert.equal(JSON.stringify(publishers[0]).includes(FIXED_SENTINEL), false, 'publisher evidence must not contain the sentinel value');
    const expectedHookProducts = profile === 'hosting'
      ? ['hosting', 'hosting']
      : profile === 'functions'
        ? ['functions', 'functions']
        : ['hosting', 'hosting', 'functions', 'functions'];
    assert.deepEqual(publishers[0].hookCalls.map((call) => call.product), expectedHookProducts, 'publisher must run each candidate predeploy hook with verified context');
    const expectedFunctionsIgnore = profile === 'hosting'
      ? originalFunctionsIgnore
      : [...originalFunctionsIgnore, '.env', '.env.demo-project', '.env.default'];
    assert.deepEqual(publishers[0].functionsIgnore, expectedFunctionsIgnore);
    assert.deepEqual(publishers[0].hostingPredeploy, ['node scripts/release/firebase-release.cjs hook --product hosting']);
    assert.deepEqual(publishers[0].functionsPredeploy, ['node scripts/release/firebase-release.cjs hook --product functions']);
    assert.equal(publishers[0].dotenvPresent, profile !== 'hosting');
    assert.equal(publishers[0].dotenvMatchesExpected, profile !== 'hosting');
    const candidateIndexPath = path.join(receipt.value.candidateRoot, 'public/database/RA/connected-speech-index.json');
    const candidateIndex = readJson(candidateIndexPath);
    assert.equal(candidateIndex.inputs.workbookSha256, sha256File(path.join(fixture.root, 'public/database/RA/RA.xlsx')));
    assert.equal(candidateIndex.inputs.audioManifestSha256, sha256File(path.join(fixture.root, 'public/database/RA/Voice/audio/manifest.json')));
    if (profile !== 'functions') {
      const versionDate = new Date((receipt.value.committerEpoch + (7 * 60 * 60)) * 1000).toISOString().slice(0, 10).replace(/-/g, '');
      const expectedCrmVersion = `${versionDate}-v1.2.3`;
      assert.match(fs.readFileSync(path.join(receipt.value.candidateRoot, 'public/index.html'), 'utf8'), /version-indicator[^>]*>V1\.2\.3/);
      assert.match(fs.readFileSync(path.join(receipt.value.candidateRoot, 'public/crm-admin.html'), 'utf8'), new RegExp(expectedCrmVersion));
      assert.match(fs.readFileSync(path.join(receipt.value.candidateRoot, 'public/crm-entrance-test-result.html'), 'utf8'), new RegExp(expectedCrmVersion));
      assert.match(fs.readFileSync(path.join(receipt.value.candidateRoot, 'GEMINI.md'), 'utf8'), /Phase\*\*: Release V1\.2\.3/);
    }
    assert.equal(receipt.value.surface.some((item) => item.path.endsWith('.env.demo-project')), false, 'private dotenv must not enter the receipt surface');
    const candidateDotenv = path.join(receipt.value.candidateRoot, 'functions/.env.demo-project');
    if (profile === 'hosting') assert.equal(fs.existsSync(candidateDotenv), false, 'hosting must not stage Functions dotenv');
    else {
      assert.equal(fs.readFileSync(candidateDotenv, 'utf8'), `PRIVATE_SETTING=${PRIVATE_VALUE}\n`);
      const presentDotenv = receipt.value.privateInputs.dotenv.filter((item) => item.present !== false);
      const absentDotenv = receipt.value.privateInputs.dotenv.filter((item) => item.present === false);
      assert.deepEqual(presentDotenv.map((item) => item.path), ['functions/.env.demo-project']);
      assert.deepEqual(absentDotenv.map((item) => item.path), ['functions/.env', 'functions/.env.default']);
      assert.equal(presentDotenv[0].sha256, sha256File(candidateDotenv), 'receipt private input binding must match the staged bytes');
      const publisherEvidence = JSON.stringify(publishers[0]);
      assert.equal(publisherEvidence.includes(PRIVATE_VALUE), false, 'publisher evidence must not contain private dotenv bytes');
      assert.equal(publisherEvidence.includes(sha256File(candidateDotenv)), false, 'publisher evidence must not contain private dotenv hashes');
    }
    const receiptText = fs.readFileSync(receipt.path, 'utf8');
    assert.equal(receiptText.includes(PRIVATE_VALUE), false, 'private dotenv bytes must not enter the receipt');
  }
});

test('release CLI exports the selected Git tree while HEAD points at another commit', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
  const selected = runRelease(fixture, 'hosting', { sha: fixture.sourceASha, expectedMarker: 'source-A' });
  jsonOutput(selected);
  const selectedPublisher = readJsonLines(path.join(selected.profileRoot, 'publisher.jsonl'))[0];
  assert.equal(selectedPublisher.sourceMarker, 'source-A\n');

  const head = runRelease(fixture, 'hosting', { sha: fixture.sourceBSha, expectedMarker: 'source-B' });
  jsonOutput(head);
  const headPublisher = readJsonLines(path.join(head.profileRoot, 'publisher.jsonl'))[0];
  assert.equal(headPublisher.sourceMarker, 'source-B\n');
  assert.notEqual(selectedPublisher.candidateRoot, headPublisher.candidateRoot);
});

test('release CLI rejects a selected commit whose Firebase alias resolves differently from original HEAD', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  writeJson(path.join(fixture.root, '.firebaserc'), { projects: { default: 'alternate-project' } });
  runGit(fixture.root, ['add', '.firebaserc']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'change original Firebase alias target']);
  const originalHead = runGit(fixture.root, ['rev-parse', 'HEAD']);
  assert.notEqual(originalHead, fixture.sourceASha, 'identity fixture must have a distinct original HEAD');

  const mismatched = runRelease(fixture, 'hosting', {
    sha: fixture.sourceASha,
    expectedMarker: 'source-A'
  });
  assert.notEqual(mismatched.status, 0, 'a selected commit with a different alias target must be rejected');
  assert.match(mismatched.stderr, /FIREBASE_PROJECT|identity|match|original/i);
  assert.deepEqual(readJsonLines(path.join(mismatched.profileRoot, 'preparation.jsonl')), [], 'identity mismatch must fail before preparation');
  assert.deepEqual(readJsonLines(path.join(mismatched.profileRoot, 'publisher.jsonl')), [], 'identity mismatch must fail before publication');
  assert.deepEqual(receiptFiles(mismatched), [], 'identity mismatch must not seal a receipt');
});

test('root, full, and Functions npm aliases select default HEAD with preserved working directories', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
  const npmCli = process.env.STR03A_NPM_CLI || path.join(path.dirname(NODE_EXE), 'node_modules/npm/bin/npm-cli.js');
  assert.equal(fs.existsSync(npmCli), true, `approved runtime npm CLI must exist at ${npmCli}`);

  const rootRun = path.join(fixture.externalRoot, 'npm-root');
  fs.mkdirSync(rootRun, { recursive: true });
  const rootResult = spawnSync(NODE_EXE, [npmCli,
    '--silent', 'run', 'deploy', '--', '--firebase-cli', fixture.fakeCli.entrypoint, '--npm-cli', fixture.fakeNpm,
    '--external-root', rootRun, '--json'
  ], {
    cwd: fixture.root,
    env: baseEnvironment(fixture, rootRun, { expectedMarker: 'source-B' }),
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 120000
  });
  assert.equal(rootResult.status, 0, String(rootResult.stderr || rootResult.stdout));
  const rootOutput = parseFinalJsonLine(rootResult.stdout, 'root npm deploy');
  assert.equal(rootOutput.sourceSha, fixture.sourceBSha, 'root npm alias must select committed default HEAD');
  assert.equal(rootOutput.selector, 'hosting');
  const rootPublish = readJsonLines(path.join(rootRun, 'publisher.jsonl'))[0];
  assert.equal(rootPublish.sourceMarker, 'source-B\n');
  assert.equal(rootPublish.selector, 'hosting');
  assert.equal(path.resolve(rootPublish.cwd), path.resolve(rootPublish.candidateRoot));

  const fullRun = path.join(fixture.externalRoot, 'npm-full');
  fs.mkdirSync(fullRun, { recursive: true });
  const fullResult = spawnSync(NODE_EXE, [npmCli,
    '--silent', 'run', 'deploy:full', '--', '--firebase-cli', fixture.fakeCli.entrypoint, '--npm-cli', fixture.fakeNpm,
    '--external-root', fullRun, '--json'
  ], {
    cwd: fixture.root,
    env: baseEnvironment(fixture, fullRun, { expectedMarker: 'source-B', expectDotenv: true }),
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 120000
  });
  assert.equal(fullResult.status, 0, String(fullResult.stderr || fullResult.stdout));
  const fullOutput = parseFinalJsonLine(fullResult.stdout, 'full npm deploy');
  assert.equal(fullOutput.sourceSha, fixture.sourceBSha, 'full npm alias must select committed default HEAD');
  assert.equal(fullOutput.selector, 'hosting,functions:api,firestore:rules');
  const fullPublish = readJsonLines(path.join(fullRun, 'publisher.jsonl'))[0];
  assert.equal(fullPublish.sourceMarker, 'source-B\n');
  assert.equal(fullPublish.selector, 'hosting,functions:api,firestore:rules');
  assert.equal(path.resolve(fullPublish.cwd), path.resolve(fullPublish.candidateRoot));

  const functionsRun = path.join(fixture.externalRoot, 'npm-functions');
  fs.mkdirSync(functionsRun, { recursive: true });
  const functionsResult = spawnSync(NODE_EXE, [npmCli,
    '--silent', '--prefix', path.join(fixture.root, 'functions'), 'run', 'deploy', '--',
    '--firebase-cli', fixture.fakeCli.entrypoint, '--npm-cli', fixture.fakeNpm, '--external-root', functionsRun, '--json'
  ], {
    cwd: fixture.root,
    env: baseEnvironment(fixture, functionsRun, { expectedMarker: 'source-B', expectDotenv: true }),
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 120000
  });
  assert.equal(functionsResult.status, 0, String(functionsResult.stderr || functionsResult.stdout));
  const functionsOutput = parseFinalJsonLine(functionsResult.stdout, 'Functions npm deploy');
  assert.equal(functionsOutput.sourceSha, fixture.sourceBSha, 'Functions npm alias must select committed default HEAD');
  assert.equal(functionsOutput.selector, 'functions');
  const functionsPublish = readJsonLines(path.join(functionsRun, 'publisher.jsonl'))[0];
  assert.equal(functionsPublish.selector, 'functions');
  assert.equal(functionsPublish.sourceMarker, null, 'Functions publication must not widen to Hosting files');
  assert.equal(functionsPublish.dotenvPresent, true);
  assert.equal(functionsPublish.dotenvMatchesExpected, true);
  assert.equal(path.resolve(functionsPublish.cwd), path.join(path.resolve(functionsPublish.candidateRoot), 'functions'));
});

test('custom Functions configDir and additional source remain bound through receipt and verified hooks', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const configPath = path.join(fixture.root, 'firebase.json');
  const config = readJson(configPath);
  config.functions[0].configDir = 'functions-config';
  config.functions[0].additionalSources = ['shared/additional-runtime.js'];
  writeJson(configPath, config);
  writeText(path.join(fixture.root, 'shared/additional-runtime.js'), 'module.exports = "additional-source-v1";\n');
  runGit(fixture.root, ['add', 'firebase.json', 'shared/additional-runtime.js']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'custom Functions config layout']);
  const customSha = runGit(fixture.root, ['rev-parse', 'HEAD']);
  writeText(path.join(fixture.root, 'functions-config/.env.demo-project'), `PRIVATE_SETTING=${PRIVATE_VALUE}\n`);

  const run = runRelease(fixture, 'functions', { sha: customSha });
  jsonOutput(run);
  const receipt = receiptFor(run, 'functions', customSha);
  const presentDotenv = receipt.value.privateInputs.dotenv.filter((item) => item.present !== false);
  const absentDotenv = receipt.value.privateInputs.dotenv.filter((item) => item.present === false);
  assert.deepEqual(presentDotenv.map((item) => item.path), ['functions-config/.env.demo-project']);
  assert.deepEqual(absentDotenv.map((item) => item.path), ['functions-config/.env', 'functions-config/.env.default']);
  assert.equal(presentDotenv[0].sha256, sha256File(path.join(receipt.value.candidateRoot, 'functions-config/.env.demo-project')), 'custom config private input must carry a content binding');
  assert.equal(receipt.value.surface.some((item) => item.path === 'shared/additional-runtime.js'), true, 'additional source file must be included in the sealed surface');
  const additionalPath = path.join(receipt.value.candidateRoot, 'shared/additional-runtime.js');
  assert.equal(fs.readFileSync(additionalPath, 'utf8'), 'module.exports = "additional-source-v1";\n');

  const context = hookEnvironment(receipt);
  const baseEnv = baseEnvironment(fixture, run.profileRoot, { expectDotenv: true });
  const beforePublisher = readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length;
  writeText(additionalPath, 'module.exports = "additional-source-tampered";\n');
  const additionalTampered = runChild(fixture, ['--hook', '--product', 'functions', '--json'], { env: { ...baseEnv, ...context } });
  assert.notEqual(additionalTampered.status, 0);
  assert.match(additionalTampered.stderr, /SURFACE_CHANGED|surface|changed/i);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher);

  fs.writeFileSync(additionalPath, 'module.exports = "additional-source-v1";\n', 'utf8');
  const dotenvPath = path.join(receipt.value.candidateRoot, 'functions-config/.env.demo-project');
  writeText(dotenvPath, `PRIVATE_SETTING=${PRIVATE_VALUE}-changed\n`);
  const dotenvChanged = runChild(fixture, ['--hook', '--product', 'functions', '--json'], { env: { ...baseEnv, ...context } });
  assert.notEqual(dotenvChanged.status, 0);
  assert.match(dotenvChanged.stderr, /PRIVATE_INPUT_CHANGED|private input|changed/i);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher);

  fs.writeFileSync(dotenvPath, `PRIVATE_SETTING=${PRIVATE_VALUE}\n`, 'utf8');
  fs.rmSync(dotenvPath);
  const dotenvAbsent = runChild(fixture, ['--hook', '--product', 'functions', '--json'], { env: { ...baseEnv, ...context } });
  assert.notEqual(dotenvAbsent.status, 0);
  assert.match(dotenvAbsent.stderr, /PRIVATE_INPUT_CHANGED|private input|missing/i);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher);
});

test('Functions additionalSources rejects a selected dotenv file before preparation or publication', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const configPath = path.join(fixture.root, 'firebase.json');
  const config = readJson(configPath);
  config.functions[0].additionalSources = ['functions/.env.demo-project'];
  writeJson(configPath, config);
  runGit(fixture.root, ['add', 'firebase.json']);
  runGit(fixture.root, ['add', '--force', 'functions/.env.demo-project']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'reject private additional source']);
  const privateSourceSha = runGit(fixture.root, ['rev-parse', 'HEAD']);
  const run = runRelease(fixture, 'functions', { sha: privateSourceSha });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /PRIVATE|dotenv|additional|secret/i);
  assert.equal(fs.existsSync(path.join(run.profileRoot, 'publisher.jsonl')), false, 'private additional source must fail before publication');
  assert.equal(fs.existsSync(path.join(run.profileRoot, 'preparation.jsonl')), false, 'private additional source must fail before preparation');
});

test('verified hook rejects a recognized dotenv file introduced after an empty sealed inventory', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
  fs.rmSync(path.join(fixture.root, 'functions/.env.demo-project'));

  const run = runRelease(fixture, 'functions');
  jsonOutput(run);
  const receipt = receiptFor(run, 'functions', fixture.sourceASha);
  assert.deepEqual(receipt.value.privateInputs.dotenv.filter((item) => item.present !== false), []);
  assert.deepEqual(receipt.value.privateInputs.dotenv.filter((item) => item.present === false).map((item) => item.path), [
    'functions/.env',
    'functions/.env.demo-project',
    'functions/.env.default'
  ]);
  const candidateDotenv = path.join(receipt.value.candidateRoot, 'functions/.env.demo-project');
  writeText(candidateDotenv, `PRIVATE_SETTING=${PRIVATE_VALUE}\n`);
  const beforePublisher = readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length;
  const introduced = runChild(fixture, ['--hook', '--product', 'functions', '--json'], {
    env: { ...baseEnvironment(fixture, run.profileRoot, { expectDotenv: true }), ...hookEnvironment(receipt) }
  });
  assert.notEqual(introduced.status, 0);
  assert.match(introduced.stderr, /PRIVATE_INPUT_CHANGED|private input|introduced|unexpected/i);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher);
});

test('missing or failing generator wiring blocks publication before a receipt is sealed', (t) => {
  const missingFixture = createFixture();
  t.after(() => fs.rmSync(missingFixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(missingFixture.externalRoot, { recursive: true, force: true }));
  fs.rmSync(path.join(missingFixture.root, 'scripts/sync-version.js'));
  runGit(missingFixture.root, ['add', '--all']);
  runGit(missingFixture.root, ['commit', '--quiet', '-m', 'remove required version generator']);
  const missingSha = runGit(missingFixture.root, ['rev-parse', 'HEAD']);
  const missing = runRelease(missingFixture, 'hosting', { sha: missingSha });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /PREPARE_FAILED|version|module|cannot find/i);
  assert.equal(fs.existsSync(path.join(missing.profileRoot, 'publisher.jsonl')), false);
  assert.deepEqual(receiptFiles(missing), [], 'missing generator wiring must not seal a receipt');

  const failingFixture = createFixture();
  t.after(() => fs.rmSync(failingFixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(failingFixture.externalRoot, { recursive: true, force: true }));
  writeText(path.join(failingFixture.root, 'scripts/read-aloud/build-connected-speech-index.js'), "'use strict'; process.stderr.write('synthetic connected generator failure\\n'); process.exit(17);\n");
  runGit(failingFixture.root, ['add', 'scripts/read-aloud/build-connected-speech-index.js']);
  runGit(failingFixture.root, ['commit', '--quiet', '-m', 'fail connected generator']);
  const failingSha = runGit(failingFixture.root, ['rev-parse', 'HEAD']);
  const failing = runRelease(failingFixture, 'hosting', { sha: failingSha });
  assert.notEqual(failing.status, 0);
  assert.match(failing.stderr, /PREPARE_FAILED|connectedSpeech|generator failure/i);
  assert.equal(fs.existsSync(path.join(failing.profileRoot, 'publisher.jsonl')), false);
  assert.deepEqual(receiptFiles(failing), [], 'failing generator wiring must not seal a receipt');

  const undeclaredFixture = createFixture();
  t.after(() => fs.rmSync(undeclaredFixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(undeclaredFixture.externalRoot, { recursive: true, force: true }));
  const connectedPath = path.join(undeclaredFixture.root, 'scripts/read-aloud/build-connected-speech-index.js');
  const connectedSource = fs.readFileSync(connectedPath, 'utf8');
  const outputMarker = "const index = {";
  assert.equal(connectedSource.includes(outputMarker), true, 'fixture connected generator must have a stable output boundary');
  writeText(connectedPath, connectedSource.replace(outputMarker, "fs.writeFileSync(path.join(path.dirname(publicIndex), 'extra.js'), 'undeclared generated code\\n');\nconst index = {"));
  runGit(undeclaredFixture.root, ['add', connectedPath]);
  runGit(undeclaredFixture.root, ['commit', '--quiet', '-m', 'generate undeclared public output']);
  const undeclaredSha = runGit(undeclaredFixture.root, ['rev-parse', 'HEAD']);
  const undeclared = runRelease(undeclaredFixture, 'hosting', { sha: undeclaredSha });
  assert.notEqual(undeclared.status, 0, 'generated publish files must remain within the sealed output contract');
  assert.match(undeclared.stderr, /SURFACE_EXTRA|SURFACE|undeclared|extra\.js|publish/i);
  assert.equal(fs.existsSync(path.join(undeclared.profileRoot, 'publisher.jsonl')), false, 'undeclared generated output must fail before publication');
});

test('release rejects staged provisioned or private inputs changed by preparation before publication', (t) => {
  const variants = [
    {
      name: 'untracked provisioned audio',
      prepare(fixture) {
        writeText(path.join(fixture.root, '.gitignore'), 'functions/.env*\npublic/database/RA/Voice/audio/provisioned-prep.wav\n');
        fs.writeFileSync(path.join(fixture.root, 'public/database/RA/Voice/audio/provisioned-prep.wav'), Buffer.from('provisioned audio before preparation\n'));
      },
      mutate(fixture) {
        return `fs.writeFileSync(path.join(process.cwd(), 'public/database/RA/Voice/audio/provisioned-prep.wav'), ${JSON.stringify('provisioned audio changed during preparation\n')});`;
      },
      expected: /ASSET_CHANGED|provisioned asset|changed|audio/i
    },
    {
      name: 'existing private dotenv',
      mutate() {
        return `fs.writeFileSync(path.join(process.cwd(), 'functions', '.env.demo-project'), ${JSON.stringify('PRIVATE_SETTING=changed-during-preparation\n')});`;
      },
      expected: /PRIVATE_INPUT_CHANGED|private input|dotenv|changed/i
    },
    {
      name: 'new private dotenv',
      prepare(fixture) {
        fs.rmSync(path.join(fixture.root, 'functions/.env.demo-project'));
      },
      mutate() {
        return `fs.writeFileSync(path.join(process.cwd(), 'functions', '.env.demo-project'), ${JSON.stringify('PRIVATE_SETTING=created-during-preparation\n')});`;
      },
      expected: /PRIVATE_INPUT_CHANGED|private input|dotenv|introduced|unexpected/i
    }
  ];

  for (const variant of variants) {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
    if (variant.prepare) variant.prepare(fixture);
    const connectedPath = path.join(fixture.root, 'scripts/read-aloud/build-connected-speech-index.js');
    const connectedSource = fs.readFileSync(connectedPath, 'utf8');
    const guard = "if (!workbook || !audioManifest) throw new Error('fixture connected speech input arguments are incomplete');";
    assert.equal(connectedSource.includes(guard), true, 'fixture connected generator must expose its input guard');
    writeText(connectedPath, connectedSource.replace(guard, `${guard}\n${variant.mutate(fixture)}`));
    runGit(fixture.root, ['add', connectedPath]);
    runGit(fixture.root, ['commit', '--quiet', '-m', `mutate ${variant.name} during preparation`]);
    const mutationSha = runGit(fixture.root, ['rev-parse', 'HEAD']);

    const run = runRelease(fixture, 'functions', { sha: mutationSha });
    assert.notEqual(run.status, 0, `${variant.name} must fail against the pre-preparation inventory`);
    assert.match(run.stderr, variant.expected);
    assert.equal(fs.existsSync(path.join(run.profileRoot, 'publisher.jsonl')), false, `${variant.name} must fail before publication`);
    assert.deepEqual(receiptFiles(run), [], `${variant.name} must not seal a receipt`);
  }
});

test('explicit Functions ignore lists remain narrow while node_modules and .git files are sealed and tamper checked', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const configPath = path.join(fixture.root, 'firebase.json');
  const config = readJson(configPath);
  config.functions[0].ignore = [];
  writeJson(configPath, config);
  writeText(path.join(fixture.root, 'functions/node_modules/fixture-dependency.js'), 'module.exports = "node-modules-fixture";\n');
  runGit(fixture.root, ['add', '--force', 'functions/node_modules/fixture-dependency.js']);
  runGit(fixture.root, ['add', 'firebase.json']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'exercise explicit Functions ignore list']);
  const explicitIgnoreSha = runGit(fixture.root, ['rev-parse', 'HEAD']);

  const run = runRelease(fixture, 'functions', { sha: explicitIgnoreSha, environment: { FAKE_NPM_CREATE_DOTGIT: '1' } });
  jsonOutput(run);
  const receipt = receiptFor(run, 'functions', explicitIgnoreSha);
  const publisher = readJsonLines(path.join(run.profileRoot, 'publisher.jsonl'))[0];
  assert.deepEqual(publisher.functionsIgnore, ['.env', '.env.demo-project', '.env.default'], 'explicit Functions ignore rules must remain narrow apart from the dotenv additions');
  assert.ok(receipt.value.surface.some((item) => item.path === 'firebase.json'), 'sealed surface must include the selected Functions config');
  assert.ok(receipt.value.surface.some((item) => item.path === 'functions/node_modules/fixture-dependency.js'), 'node_modules files the explicit CLI configuration would include must be sealed');
  assert.ok(receipt.value.surface.some((item) => item.path === 'functions/node_modules/fixture-dependency/.git/metadata'), '.git files generated inside an uploadable dependency must be sealed');

  for (const [relative, replacement] of [
    ['functions/node_modules/fixture-dependency.js', 'module.exports = "tampered-node-modules-fixture";\n'],
    ['functions/node_modules/fixture-dependency/.git/metadata', 'tampered dependency metadata\n']
  ]) {
    writeText(path.join(receipt.value.candidateRoot, relative), replacement);
    const tampered = runChild(fixture, ['--hook', '--product', 'functions', '--json'], {
      env: { ...baseEnvironment(fixture, run.profileRoot, { expectDotenv: true }), ...hookEnvironment(receipt) }
    });
    assert.notEqual(tampered.status, 0, `${relative} tampering must fail verification`);
    assert.match(tampered.stderr, /SURFACE_CHANGED|surface|changed/i);
    assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, 1, `${relative} tampering must not republish`);
    if (relative.endsWith('fixture-dependency.js')) writeText(path.join(receipt.value.candidateRoot, relative), 'module.exports = "node-modules-fixture";\n');
    else writeText(path.join(receipt.value.candidateRoot, relative), 'synthetic dependency metadata\n');
  }

  const nested = createFixture();
  t.after(() => fs.rmSync(nested.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(nested.externalRoot, { recursive: true, force: true }));
  const nestedConfigPath = path.join(nested.root, 'firebase.json');
  const nestedConfig = readJson(nestedConfigPath);
  nestedConfig.functions[0].ignore = ['#file', 'sub/file.js'];
  writeJson(nestedConfigPath, nestedConfig);
  writeText(path.join(nested.root, 'functions/sub/file.js'), 'module.exports = "nested-ignore-fixture";\n');
  runGit(nested.root, ['add', 'firebase.json', 'functions/sub/file.js']);
  runGit(nested.root, ['commit', '--quiet', '-m', 'exercise relative Functions ignore rule']);
  const nestedSha = runGit(nested.root, ['rev-parse', 'HEAD']);
  const nestedRun = runRelease(nested, 'functions', { sha: nestedSha });
  jsonOutput(nestedRun);
  const nestedReceipt = receiptFor(nestedRun, 'functions', nestedSha);
  const nestedPublisher = readJsonLines(path.join(nestedRun.profileRoot, 'publisher.jsonl'))[0];
  assert.deepEqual(nestedPublisher.functionsIgnore, ['#file', 'sub/file.js', '.env', '.env.demo-project', '.env.default']);
  assert.ok(nestedReceipt.value.surface.some((item) => item.path === 'functions/sub/file.js'), 'a relative subpath ignore rule must not silently omit the nested uploaded file');
  const nestedFile = path.join(nestedReceipt.value.candidateRoot, 'functions/sub/file.js');
  writeText(nestedFile, 'module.exports = "tampered-nested-ignore-fixture";\n');
  const nestedTampered = runChild(nested, ['--hook', '--product', 'functions', '--json'], {
    env: { ...baseEnvironment(nested, nestedRun.profileRoot, { expectDotenv: true }), ...hookEnvironment(nestedReceipt) }
  });
  assert.notEqual(nestedTampered.status, 0, 'tampering a nested file selected by the Firebase upload must fail verification');
  assert.match(nestedTampered.stderr, /SURFACE_CHANGED|surface|changed/i);
});

test('explicit project ID avoids configstore and numeric project numbers fail before publication', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
  const explicit = runRelease(fixture, 'hosting', { project: 'demo-project', environment: { FAKE_CONFIGSTORE_MUST_NOT_LOAD: '1' } });
  jsonOutput(explicit);
  const explicitPublisher = readJsonLines(path.join(explicit.profileRoot, 'publisher.jsonl'))[0];
  assert.equal(explicitPublisher.project, 'demo-project');

  const numericRoot = path.join(fixture.externalRoot, 'numeric');
  fs.mkdirSync(numericRoot, { recursive: true });
  const numeric = runChild(fixture, [
    'hosting', '--sha', fixture.sourceASha, '--project', '123456789', '--firebase-cli', fixture.fakeCli.entrypoint, '--npm-cli', fixture.fakeNpm,
    '--external-root', numericRoot, '--json'
  ], { env: baseEnvironment(fixture, numericRoot) });
  assert.notEqual(numeric.status, 0);
  assert.match(numeric.stderr, /NUMERIC|project ID|alias/i);
  assert.equal(fs.existsSync(path.join(numericRoot, 'publisher.jsonl')), false, 'numeric project rejection must precede publication');
  assert.equal(fs.existsSync(path.join(numericRoot, 'preparation.jsonl')), false, 'numeric project rejection must precede preparation');
});

test('verified hook context is read-only, mutation is rejected, and absent context keeps legacy behavior', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
  const run = runRelease(fixture, 'hosting');
  jsonOutput(run);
  const receipt = receiptFor(run, 'hosting', fixture.sourceASha);
  const context = hookEnvironment(receipt);
  const baseEnv = baseEnvironment(fixture, run.profileRoot);
  const beforePreparation = readJsonLines(path.join(run.profileRoot, 'preparation.jsonl')).length;
  const beforePublisher = readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length;

  const valid = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: { ...baseEnv, ...context } });
  const validOutput = jsonOutput(valid);
  assert.deepEqual(validOutput, { ok: true, mode: 'verified', product: 'hosting' });
  assert.equal(readJsonLines(path.join(run.profileRoot, 'preparation.jsonl')).length, beforePreparation);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher);

  const requiredHookFields = [
    'BEL_FIREBASE_RELEASE_CONTEXT',
    'BEL_FIREBASE_RELEASE_RECEIPT',
    'BEL_FIREBASE_RELEASE_PROFILE',
    'BEL_FIREBASE_RELEASE_CANDIDATE_ROOT',
    'BEL_FIREBASE_RELEASE_SOURCE_SHA',
    'BEL_FIREBASE_RELEASE_PROJECT_ID',
    'BEL_FIREBASE_RELEASE_CONFIG_PATH',
    'BEL_FIREBASE_RELEASE_SURFACE_SHA256'
  ];
  for (const field of requiredHookFields) {
    const missingEnv = { ...baseEnv, ...context };
    delete missingEnv[field];
    const missing = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: missingEnv });
    assert.notEqual(missing.status, 0, `${field} omission must reject the verified hook context`);
    assert.match(missing.stderr, /INVALID_HOOK_CONTEXT|incomplete|missing/i);
    const blankEnv = { ...baseEnv, ...context, [field]: '' };
    const blank = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: blankEnv });
    assert.notEqual(blank.status, 0, `${field} blank value must reject the verified hook context`);
    assert.match(blank.stderr, /INVALID_HOOK_CONTEXT|incomplete|missing/i);
  }
  const wrongIdentity = [
    ['BEL_FIREBASE_RELEASE_CONTEXT', 'wrong-marker'],
    ['BEL_FIREBASE_RELEASE_PROFILE', 'functions'],
    ['BEL_FIREBASE_RELEASE_CANDIDATE_ROOT', path.join(fixture.externalRoot, 'wrong-candidate')],
    ['BEL_FIREBASE_RELEASE_SOURCE_SHA', '0'.repeat(40)],
    ['BEL_FIREBASE_RELEASE_PROJECT_ID', 'other-project'],
    ['BEL_FIREBASE_RELEASE_CONFIG_PATH', path.join(fixture.externalRoot, 'wrong-config.json')],
    ['BEL_FIREBASE_RELEASE_SURFACE_SHA256', '0'.repeat(64)],
    ['BEL_FIREBASE_RELEASE_PROJECT_ALIAS', 'other-alias']
  ];
  for (const [field, value] of wrongIdentity) {
    const wrongEnv = { ...baseEnv, ...context, [field]: value };
    const wrong = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: wrongEnv });
    assert.notEqual(wrong.status, 0, `${field} mismatch must reject the verified hook context`);
    assert.match(wrong.stderr, /INVALID_HOOK_CONTEXT|identity|mismatch|unsupported/i);
  }
  const wrongFirebaseEnvironment = [
    ['PROJECT_DIR', path.join(fixture.externalRoot, 'wrong-project-dir')],
    ['RESOURCE_DIR', path.join(fixture.externalRoot, 'wrong-resource-dir')],
    ['GCLOUD_PROJECT', 'other-project']
  ];
  for (const [field, value] of wrongFirebaseEnvironment) {
    const wrongEnv = { ...baseEnv, ...context, [field]: value };
    const wrong = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: wrongEnv });
    assert.notEqual(wrong.status, 0, `${field} mismatch must reject the Firebase hook context`);
    assert.match(wrong.stderr, /INVALID_HOOK_CONTEXT|Firebase|project|resource|candidate/i);
  }
  assert.equal(readJsonLines(path.join(run.profileRoot, 'preparation.jsonl')).length, beforePreparation, 'invalid verified hooks must not run legacy generators');
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher, 'invalid verified hooks must not publish');

  const explicitRun = runRelease(fixture, 'hosting', { project: 'demo-project', environment: { FAKE_CONFIGSTORE_MUST_NOT_LOAD: '1' } });
  jsonOutput(explicitRun);
  const explicitReceipt = receiptFor(explicitRun, 'hosting', fixture.sourceASha);
  const explicitContext = hookEnvironment(explicitReceipt);
  assert.equal(explicitContext.BEL_FIREBASE_RELEASE_PROJECT_ALIAS, '', 'explicit project ID should carry a blank alias');
  const explicitValid = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], {
    env: { ...baseEnvironment(fixture, explicitRun.profileRoot), ...explicitContext }
  });
  assert.deepEqual(jsonOutput(explicitValid), { ok: true, mode: 'verified', product: 'hosting' });
  const explicitMissingAlias = { ...baseEnvironment(fixture, explicitRun.profileRoot), ...explicitContext };
  delete explicitMissingAlias.BEL_FIREBASE_RELEASE_PROJECT_ALIAS;
  const missingAlias = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: explicitMissingAlias });
  assert.notEqual(missingAlias.status, 0, 'omitting the alias field must reject an otherwise complete explicit-ID context');
  assert.match(missingAlias.stderr, /INVALID_HOOK_CONTEXT|alias|incomplete|missing/i);

  writeText(path.join(receipt.value.candidateRoot, 'public/index.html'), '<!doctype html><title>tampered</title>\n');
  const mutated = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: { ...baseEnv, ...context } });
  assert.notEqual(mutated.status, 0);
  assert.match(mutated.stderr, /SURFACE_CHANGED|changed|surface/i);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')).length, beforePublisher);

  const partial = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], {
    env: { ...baseEnv, BEL_FIREBASE_RELEASE_CONTEXT: '1' }
  });
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /INVALID_HOOK_CONTEXT|incomplete|release context/i);
  assert.equal(readJsonLines(path.join(run.profileRoot, 'preparation.jsonl')).length, beforePreparation);

  for (const receiptCase of [
    { name: 'missing', path: path.join(fixture.externalRoot, 'missing-hook-receipt.json') },
    { name: 'directory', path: path.join(fixture.externalRoot, 'unreadable-hook-receipt') }
  ]) {
    if (receiptCase.name === 'directory') fs.mkdirSync(receiptCase.path, { recursive: true });
    const receiptLog = path.join(fixture.externalRoot, `${receiptCase.name}-receipt-hook.jsonl`);
    const invalidReceipt = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], {
      env: {
        ...baseEnv,
        ...context,
        BEL_FIREBASE_RELEASE_RECEIPT: receiptCase.path,
        RELEASE_PREP_LOG: receiptLog
      }
    });
    assert.notEqual(invalidReceipt.status, 0, `${receiptCase.name} receipt path must reject verified hook context`);
    assert.match(invalidReceipt.stderr, /INVALID_HOOK_CONTEXT|receipt|missing|unreadable|regular/i);
    assert.deepEqual(readJsonLines(receiptLog), [], `${receiptCase.name} receipt failure must not fall back to legacy generators`);
  }

  const legacyLog = path.join(fixture.externalRoot, 'legacy-hook.jsonl');
  const legacyEnv = { ...baseEnv, RELEASE_PREP_LOG: legacyLog };
  for (const key of Object.keys(context)) delete legacyEnv[key];
  const legacy = runChild(fixture, ['--hook', '--product', 'hosting', '--json'], { env: legacyEnv });
  const legacyOutput = jsonOutput(legacy);
  assert.deepEqual(legacyOutput, { ok: true, mode: 'legacy', product: 'hosting' });
  assert.deepEqual(readJsonLines(legacyLog).map((item) => item.kind), ['legacy-connectedSpeech']);

  const rawFunctions = createFixture();
  t.after(() => fs.rmSync(rawFunctions.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(rawFunctions.externalRoot, { recursive: true, force: true }));
  const rawFunctionsRoot = path.join(rawFunctions.externalRoot, 'raw-functions');
  fs.mkdirSync(rawFunctionsRoot, { recursive: true });
  const rawFunctionsLog = path.join(rawFunctionsRoot, 'raw-functions.jsonl');
  const rawFunctionsSourcePath = path.join(rawFunctions.root, 'scripts/data/segmentation-study-v2.json');
  const rawFunctionsDestinationPath = path.join(rawFunctions.root, 'functions/src/data/segmentation-study-v2.json');
  const rawFunctionsSource = fs.readFileSync(rawFunctionsSourcePath);
  writeText(rawFunctionsDestinationPath, 'stale segmentation output before raw hook\n');
  const rawFunctionsResult = runChild(rawFunctions, ['--hook', '--product', 'functions', '--json'], {
    env: { ...baseEnvironment(rawFunctions, rawFunctionsRoot), RELEASE_PREP_LOG: rawFunctionsLog }
  });
  const rawFunctionsOutput = jsonOutput(rawFunctionsResult);
  assert.deepEqual(rawFunctionsOutput, { ok: true, mode: 'legacy', product: 'functions' });
  assert.deepEqual(readJsonLines(rawFunctionsLog).map((item) => item.kind), ['legacy-connectedSpeech', 'segmentationV2'], 'raw Functions hook must run connected speech before the copied real V2 generator exactly once');
  assert.deepEqual(fs.readFileSync(rawFunctionsDestinationPath), rawFunctionsSource, 'raw Functions V2 hook must use the copied real generator to restore the selected manifest');
  assert.deepEqual(receiptFiles({ profileRoot: rawFunctionsRoot }), [], 'raw Functions hook must not create a release receipt');
  assert.equal(fs.existsSync(path.join(rawFunctionsRoot, 'publisher.jsonl')), false, 'raw Functions hook must not publish');

  const failingRawFunctions = createFixture();
  t.after(() => fs.rmSync(failingRawFunctions.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(failingRawFunctions.externalRoot, { recursive: true, force: true }));
  const failingRawRoot = path.join(failingRawFunctions.externalRoot, 'raw-functions-failure');
  fs.mkdirSync(failingRawRoot, { recursive: true });
  const failingRawLog = path.join(failingRawRoot, 'raw-functions.jsonl');
  const failingConnectedPath = path.join(failingRawFunctions.root, 'scripts/read-aloud/build-connected-speech-index.js');
  const failingConnectedSource = fs.readFileSync(failingConnectedPath, 'utf8');
  const noArgsMarker = "if (!value('--public-index')) {";
  assert.equal(failingConnectedSource.includes(noArgsMarker), true, 'raw Functions failure fixture must expose the legacy branch');
  writeText(failingConnectedPath, failingConnectedSource.replace(noArgsMarker, `${noArgsMarker} process.stderr.write('synthetic legacy connected failure\\n'); process.exit(19);`));
  const failingRaw = runChild(failingRawFunctions, ['--hook', '--product', 'functions', '--json'], {
    env: { ...baseEnvironment(failingRawFunctions, failingRawRoot), RELEASE_PREP_LOG: failingRawLog }
  });
  assert.notEqual(failingRaw.status, 0, 'raw Functions hook must propagate a connected speech generator failure');
  assert.match(failingRaw.stderr, /LEGACY_HOOK_FAILED|legacy-connectedSpeech|synthetic legacy connected failure/i);
  assert.deepEqual(readJsonLines(failingRawLog), [], 'a failed connected speech generator must prevent the V2 generator from running');
  assert.deepEqual(receiptFiles({ profileRoot: failingRawRoot }), [], 'failed raw Functions hook must not create a release receipt');
  assert.equal(fs.existsSync(path.join(failingRawRoot, 'publisher.jsonl')), false, 'failed raw Functions hook must not publish');
});

test('surface inventory catches same-size large-file tampering and unresolved LFS pointers', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
  const controller = require(CONTROLLER_SOURCE);

  const hydratedBytes = Buffer.from('hydrated LFS fixture bytes\n');
  const hydratedPath = path.join(fixture.root, 'public/hydrated.bin');
  writeText(hydratedPath, `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(hydratedBytes)}\nsize ${hydratedBytes.length}\n`);
  runGit(fixture.root, ['add', 'public/hydrated.bin']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'fixture hydrated LFS pointer']);
  const hydratedSha = runGit(fixture.root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(hydratedPath, hydratedBytes);
  const hydratedCandidate = controller.createCandidate({
    sourceRoot: fixture.root,
    sourceSha: hydratedSha,
    externalRoot: path.join(fixture.externalRoot, 'hydrated-candidate')
  });
  assert.deepEqual(fs.readFileSync(path.join(hydratedCandidate.candidateRoot, 'public/hydrated.bin')), hydratedBytes, 'matching worktree bytes must hydrate the selected LFS pointer');

  const candidate = makeTempDirectory('inventory-candidate');
  t.after(() => fs.rmSync(candidate, { recursive: true, force: true }));
  fs.mkdirSync(path.join(candidate, 'public'), { recursive: true });
  writeText(path.join(candidate, 'public/index.html'), 'fixture\n');
  const largePath = path.join(candidate, 'public/large.bin');
  fs.writeFileSync(largePath, Buffer.alloc(33 * 1024 * 1024, 0x41));
  const before = controller.inventorySurface({ candidateRoot: candidate, profile: 'hosting' });
  const largeBefore = before.find((item) => item.path === 'public/large.bin');
  assert.ok(largeBefore && largeBefore.sha256, 'large publish files must receive a content hash');
  const largeFd = fs.openSync(largePath, 'r+');
  try { fs.writeSync(largeFd, Buffer.from([0x42]), 0, 1, 0); } finally { fs.closeSync(largeFd); }
  const after = controller.inventorySurface({ candidateRoot: candidate, profile: 'hosting' });
  assert.notDeepEqual(controller.compareInventory(before, after), [], 'same-size large-file mutation must be visible to sealed-surface comparison');
  writeText(path.join(candidate, 'public/unresolved.lfs'), 'version https://git-lfs.github.com/spec/v1\noid sha256:fixture\nsize 12\n');
  assert.throws(() => controller.inventorySurface({ candidateRoot: candidate, profile: 'hosting' }), /LFS|pointer|unresolved/i);
});

test('release source guard rejects applicable tracked dirt while allowing unrelated tracked dirt', (t) => {
  const applicable = createFixture();
  t.after(() => fs.rmSync(applicable.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(applicable.externalRoot, { recursive: true, force: true }));

  writeText(path.join(applicable.root, 'public/index.html'), '<!doctype html><div>locally modified release input</div>\n');
  const rejected = runRelease(applicable, 'hosting', {
    sha: applicable.sourceBSha,
    expectedMarker: 'source-B'
  });
  assert.notEqual(rejected.status, 0, 'tracked Hosting input changes must block release');
  assert.match(rejected.stderr, /DIRTY_RELEASE_INPUT|Tracked release inputs|modified/i);
  assert.deepEqual(readJsonLines(path.join(rejected.profileRoot, 'preparation.jsonl')), [], 'dirty input must fail before preparation');
  assert.deepEqual(readJsonLines(path.join(rejected.profileRoot, 'publisher.jsonl')), [], 'dirty input must fail before publication');

  const unrelated = createFixture();
  t.after(() => fs.rmSync(unrelated.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(unrelated.externalRoot, { recursive: true, force: true }));
  writeText(path.join(unrelated.root, 'functions/src/index.js'), 'module.exports = { unrelatedLocalChange: true };\n');
  const permitted = runRelease(unrelated, 'hosting', {
    sha: unrelated.sourceBSha,
    expectedMarker: 'source-B'
  });
  jsonOutput(permitted);
  const publishers = readJsonLines(path.join(permitted.profileRoot, 'publisher.jsonl'));
  assert.equal(publishers.length, 1, 'unrelated Functions dirt must not block Hosting publication');
  assert.equal(publishers[0].selector, 'hosting');
});

test('selected older commits missing the release wrapper or exact predeploy hook fail before fake preparation and publication', (t) => {
  const variants = [
    {
      name: 'wrapper',
      mutate(fixture) {
        fs.rmSync(path.join(fixture.root, 'scripts/release/firebase-release.cjs'));
      },
      restore(fixture, original) {
        fs.writeFileSync(path.join(fixture.root, 'scripts/release/firebase-release.cjs'), original);
      },
      expected: /SOURCE_WIRING|firebase-release\.cjs|release wiring/i
    },
    {
      name: 'predeploy',
      mutate(fixture) {
        const configPath = path.join(fixture.root, 'firebase.json');
        const config = readJson(configPath);
        config.hosting.predeploy = ['node scripts/sync-version.js'];
        writeJson(configPath, config);
      },
      restore(fixture, original) {
        writeText(path.join(fixture.root, 'firebase.json'), original);
      },
      expected: /SOURCE_WIRING|release hook|predeploy/i
    }
  ];

  for (const variant of variants) {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));
    const wrapperPath = path.join(fixture.root, 'scripts/release/firebase-release.cjs');
    const configPath = path.join(fixture.root, 'firebase.json');
    const originalWrapper = fs.readFileSync(wrapperPath);
    const originalConfig = fs.readFileSync(configPath, 'utf8');

    variant.mutate(fixture);
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', `remove selected ${variant.name} release wiring`]);
    const missingWiringSha = runGit(fixture.root, ['rev-parse', 'HEAD']);

    variant.restore(fixture, variant.name === 'wrapper' ? originalWrapper : originalConfig);
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', `restore current ${variant.name} release wiring`]);
    assert.notEqual(missingWiringSha, runGit(fixture.root, ['rev-parse', 'HEAD']), 'selected wiring fixture must be older than current HEAD');

    const run = runRelease(fixture, 'hosting', {
      sha: missingWiringSha,
      expectedMarker: 'source-B'
    });
    assert.notEqual(run.status, 0, `${variant.name} wiring omission must block the selected commit`);
    assert.match(run.stderr, variant.expected);
    assert.deepEqual(readJsonLines(path.join(run.profileRoot, 'preparation.jsonl')), [], `${variant.name} omission must fail before preparation`);
    assert.deepEqual(readJsonLines(path.join(run.profileRoot, 'publisher.jsonl')), [], `${variant.name} omission must fail before publication`);
    assert.deepEqual(receiptFiles(run), [], `${variant.name} omission must not seal a receipt`);
  }
});

test('selected LFS files hydrate only with exact worktree oid and size, while irrelevant Hosting pointers do not block Functions', (t) => {
  const controller = require(CONTROLLER_SOURCE);

  const exact = createFixture();
  t.after(() => fs.rmSync(exact.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(exact.externalRoot, { recursive: true, force: true }));
  const exactRelative = 'functions/src/data/selected-lfs.bin';
  const exactBytes = Buffer.from('selected Functions LFS bytes\n', 'utf8');
  const exactPointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(exactBytes)}\nsize ${exactBytes.length}\n`;
  writeText(path.join(exact.root, exactRelative), exactPointer);
  runGit(exact.root, ['add', exactRelative]);
  runGit(exact.root, ['commit', '--quiet', '-m', 'selected exact LFS pointer']);
  const exactSha = runGit(exact.root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(exact.root, exactRelative), exactBytes);
  const exactCandidate = controller.createCandidate({
    sourceRoot: exact.root,
    sourceSha: exactSha,
    externalRoot: path.join(exact.externalRoot, 'exact-lfs')
  });
  assert.deepEqual(fs.readFileSync(path.join(exactCandidate.candidateRoot, exactRelative)), exactBytes, 'matching LFS oid and size must hydrate the selected file');
  assert.doesNotThrow(() => controller.inventorySurface({
    candidateRoot: exactCandidate.candidateRoot,
    profile: 'functions',
    config: readJson(path.join(exactCandidate.candidateRoot, 'firebase.json'))
  }));

  const wrong = createFixture();
  t.after(() => fs.rmSync(wrong.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(wrong.externalRoot, { recursive: true, force: true }));
  const wrongRelative = 'functions/src/data/wrong-lfs.bin';
  const wrongBytes = Buffer.from('expected selected LFS bytes\n', 'utf8');
  writeText(path.join(wrong.root, wrongRelative), `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(wrongBytes)}\nsize ${wrongBytes.length}\n`);
  runGit(wrong.root, ['add', wrongRelative]);
  runGit(wrong.root, ['commit', '--quiet', '-m', 'selected wrong LFS hydration']);
  const wrongSha = runGit(wrong.root, ['rev-parse', 'HEAD']);
  const wrongActualBytes = Buffer.from(wrongBytes);
  wrongActualBytes[0] ^= 0xff;
  fs.writeFileSync(path.join(wrong.root, wrongRelative), wrongActualBytes);
  assert.throws(() => {
    const wrongCandidate = controller.createCandidate({
      sourceRoot: wrong.root,
      sourceSha: wrongSha,
      externalRoot: path.join(wrong.externalRoot, 'wrong-lfs')
    });
    controller.inventorySurface({
      candidateRoot: wrongCandidate.candidateRoot,
      profile: 'functions',
      config: readJson(path.join(wrongCandidate.candidateRoot, 'firebase.json'))
    });
  }, /LFS|pointer|unresolved/i, 'wrong worktree hash must leave an applicable pointer unresolved');

  const missing = createFixture();
  t.after(() => fs.rmSync(missing.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(missing.externalRoot, { recursive: true, force: true }));
  const missingRelative = 'functions/src/data/missing-lfs.bin';
  const missingBytes = Buffer.from('missing selected LFS bytes\n', 'utf8');
  writeText(path.join(missing.root, missingRelative), `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(missingBytes)}\nsize ${missingBytes.length}\n`);
  runGit(missing.root, ['add', missingRelative]);
  runGit(missing.root, ['commit', '--quiet', '-m', 'selected missing LFS hydration']);
  const missingSha = runGit(missing.root, ['rev-parse', 'HEAD']);
  fs.rmSync(path.join(missing.root, missingRelative));
  assert.throws(() => {
    const missingCandidate = controller.createCandidate({
      sourceRoot: missing.root,
      sourceSha: missingSha,
      externalRoot: path.join(missing.externalRoot, 'missing-lfs')
    });
    controller.inventorySurface({
      candidateRoot: missingCandidate.candidateRoot,
      profile: 'functions',
      config: readJson(path.join(missingCandidate.candidateRoot, 'firebase.json'))
    });
  }, /LFS|pointer|unresolved/i, 'missing worktree bytes must leave an applicable pointer unresolved');

  const irrelevant = createFixture();
  t.after(() => fs.rmSync(irrelevant.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(irrelevant.externalRoot, { recursive: true, force: true }));
  const audioRelative = 'public/database/RA/Voice/audio/irrelevant-hosting.bin';
  const audioBytes = Buffer.from('irrelevant Hosting audio bytes\n', 'utf8');
  writeText(path.join(irrelevant.root, audioRelative), `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(audioBytes)}\nsize ${audioBytes.length}\n`);
  runGit(irrelevant.root, ['add', audioRelative]);
  runGit(irrelevant.root, ['commit', '--quiet', '-m', 'irrelevant Hosting LFS pointer']);
  const irrelevantSha = runGit(irrelevant.root, ['rev-parse', 'HEAD']);
  const functionsRun = runRelease(irrelevant, 'functions', {
    sha: irrelevantSha,
    expectedMarker: 'source-B'
  });
  jsonOutput(functionsRun);
  const functionsPublishers = readJsonLines(path.join(functionsRun.profileRoot, 'publisher.jsonl'));
  assert.equal(functionsPublishers.length, 1, 'Functions publication must proceed with an irrelevant Hosting pointer');
  assert.equal(functionsPublishers[0].selector, 'functions');
});

test('minimizeRoots prunes covered child roots while preserving siblings and canonical order', () => {
  const controller = require(CONTROLLER_SOURCE);
  assert.equal(typeof controller.minimizeRoots, 'function', 'minimizeRoots must be exported');

  // Basic normalization & child pruning
  const inputs = [
    'public/database/RA/Voice/audio',
    'public/database/RA/speech-coach-audio/v1/clips',
    'public/database/Highlight Incorrect Words/audio',
    'public/database/SST/audio',
    'public/audio',
    'public/assets',
    'public/media',
    'public'
  ];
  const minimized = controller.minimizeRoots(inputs);
  assert.deepEqual(minimized, ['public'], 'root public must prune all covered descendants');

  // Sibling preservation (public/audio vs public/audio2)
  const siblings = ['public/audio', 'public/audio2', 'public/audio/deep'];
  assert.deepEqual(controller.minimizeRoots(siblings), ['public/audio', 'public/audio2'], 'sibling directories must not prune each other');

  // Windows slashes, redundant slashes, empty elements
  const messy = ['public\\\\audio///sub//', '  public/audio  ', 'public/audio/child', '', null];
  assert.deepEqual(controller.minimizeRoots(messy), ['public/audio'], 'messy path formats must be normalized safely');

  // Inverted input order
  const inverted = ['a/b/c/d', 'a/b/c', 'a/b', 'a'];
  assert.deepEqual(controller.minimizeRoots(inverted), ['a'], 'ancestor pruning must work regardless of input ordering');
});

test('captureObservedProvisionedAssets produces identical inventory with minimized roots', (t) => {
  const controller = require(CONTROLLER_SOURCE);
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  // Create sample media files in nested directories
  writeText(path.join(fixture.root, 'public/audio/test1.mp3'), 'audio-data-1\n');
  writeText(path.join(fixture.root, 'public/database/RA/Voice/audio/ra1.mp3'), 'audio-data-2\n');
  writeText(path.join(fixture.root, 'public/database/SST/audio/sst1.wav'), 'audio-data-3\n');
  writeText(path.join(fixture.root, 'public/media/banner.png'), 'image-data-1\n');
  writeText(path.join(fixture.root, 'public/ignored.txt'), 'text-data\n');

  const tracked = controller.captureTrackedInventory(fixture.root, fixture.sourceASha);

  const inventoryMinimized = controller.captureObservedProvisionedAssets(fixture.root, tracked, {
    mediaRoots: ['public']
  });

  assert.ok(inventoryMinimized.length >= 4, 'at least 4 provisioned media items should be discovered');
  const relPaths = inventoryMinimized.map((x) => x.sourcePath).sort();
  assert.ok(relPaths.includes('public/audio/test1.mp3'));
  assert.ok(relPaths.includes('public/database/RA/Voice/audio/ra1.mp3'));
  assert.ok(relPaths.includes('public/database/SST/audio/sst1.wav'));
  assert.ok(relPaths.includes('public/media/banner.png'));
  assert.ok(!relPaths.includes('public/ignored.txt'), 'non-media files must not be included');

  for (const item of inventoryMinimized) {
    assert.ok(item.sha256 && item.sha256.length === 64, `valid sha256 expected for ${item.sourcePath}`);
    assert.ok(item.size > 0, `size > 0 expected for ${item.sourcePath}`);
  }
});

test('release CLI --verify-only verifies candidate and receipts without invoking publisher', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const profileRoot = path.join(fixture.externalRoot, 'run-verify-only');
  fs.mkdirSync(profileRoot, { recursive: true });

  const args = [
    'hosting',
    '--sha', fixture.sourceASha,
    '--firebase-cli', fixture.fakeCli.entrypoint,
    '--npm-cli', fixture.fakeNpm,
    '--external-root', profileRoot,
    '--verify-only',
    '--json'
  ];

  const result = runChild(fixture, args, {
    env: baseEnvironment(fixture, profileRoot, { expectedMarker: 'source-A' })
  });

  const output = jsonOutput(result);
  assert.equal(output.ok, true, 'verify-only must report ok: true');
  assert.equal(output.verified, true, 'verify-only must report verified: true');
  assert.equal(output.published, false, 'verify-only must report published: false');

  const publisherLog = path.join(profileRoot, 'publisher.jsonl');
  const publisherCalls = fs.existsSync(publisherLog) ? readJsonLines(publisherLog) : [];
  assert.equal(publisherCalls.length, 0, 'publisher must never be dispatched during --verify-only');

  const receipt = receiptFor({ profileRoot }, 'hosting', fixture.sourceASha);
  assert.ok(receipt.value.surface.length > 0, 'receipt must have sealed surface');

  const controller = require(CONTROLLER_SOURCE);
  let publisherCalled = false;
  const directResult = controller.runRelease({
    profile: 'hosting',
    sha: fixture.sourceASha,
    project: 'demo-project',
    configPath: path.join(fixture.root, 'firebase.json'),
    source: { root: fixture.root, sourceSha: fixture.sourceASha, committerEpoch: 1700000000, originalCwd: fixture.root },
    externalRoot: path.join(fixture.externalRoot, 'direct-verify'),
    npmCli: fixture.fakeNpm,
    firebaseCliEntrypoint: fixture.fakeCli.entrypoint,
    verifyOnly: true,
    publisher: () => {
      publisherCalled = true;
      throw new Error('STUB_PUBLISHER_INVOKED');
    }
  });
  assert.equal(publisherCalled, false, 'programmatic verifyOnly must never invoke publisher');
  assert.equal(directResult.verified, true);
  assert.equal(directResult.published, false);
});

test('phase telemetry records timers, counters, and redacted metrics outside candidate on success and failure', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(fixture.externalRoot, { recursive: true, force: true }));

  const profileRoot = path.join(fixture.externalRoot, 'run-telemetry');
  fs.mkdirSync(profileRoot, { recursive: true });

  const successRun = runRelease(fixture, 'hosting', {
    sha: fixture.sourceASha,
    environment: { TEST_BEARER: 'Bearer super-secret-token' }
  });
  jsonOutput(successRun);

  const metricsPath = path.join(successRun.profileRoot, 'release-metrics.json');
  assert.ok(fs.existsSync(metricsPath), 'release-metrics.json must be emitted outside candidate');

  const metrics = readJson(metricsPath);
  assert.equal(metrics.success, true);
  assert.equal(metrics.version, 1);
  assert.ok(metrics.wallTimeMs > 0, 'wallTimeMs must be recorded');
  assert.ok(metrics.phases['git-inventory'] !== undefined, 'git-inventory phase must be recorded');
  assert.ok(metrics.phases['media-discovery'] !== undefined, 'media-discovery phase must be recorded');
  assert.ok(metrics.counters.filesVisited > 0, 'filesVisited counter must be > 0');
  assert.ok(metrics.counters.candidateBytes > 0, 'candidateBytes must be > 0');

  const serialized = JSON.stringify(metrics);
  assert.ok(!serialized.includes('super-secret-token'), 'metrics must redact secret tokens');

  const failRoot = path.join(fixture.externalRoot, 'run-telemetry-fail');
  fs.mkdirSync(failRoot, { recursive: true });
  const badSha = '0000000000000000000000000000000000000000';
  const failResult = runChild(fixture, [
    'hosting',
    '--sha', badSha,
    '--firebase-cli', fixture.fakeCli.entrypoint,
    '--npm-cli', fixture.fakeNpm,
    '--external-root', failRoot,
    '--json'
  ], {
    env: baseEnvironment(fixture, failRoot)
  });

  assert.notEqual(failResult.status, 0, 'release must fail with nonexistent source SHA');
  const failMetricsPath = path.join(failRoot, 'release-metrics.json');
  assert.ok(fs.existsSync(failMetricsPath), 'release-metrics.json must be emitted on failure');
  const failMetrics = readJson(failMetricsPath);
  assert.equal(failMetrics.success, false, 'failure metrics must record success: false');
  assert.ok(failMetrics.error, 'failure metrics must record error details');
  assert.ok(failMetrics.error.code, 'error code must be recorded');
});

