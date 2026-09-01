/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const functionsDir = path.join(root, 'functions');
const packageJson = JSON.parse(fs.readFileSync(path.join(functionsDir, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(functionsDir, 'package-lock.json'), 'utf8'));
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));

assert.strictEqual(packageJson.engines.node, '22');
assert.strictEqual(packageJson.dependencies['firebase-functions'], '^7.3.2');
assert.strictEqual(packageJson.dependencies['firebase-admin'], '^12.7.0');
assert.strictEqual(packageLock.packages[''].engines.node, '22');
assert.strictEqual(packageLock.packages[''].dependencies['firebase-functions'], '^7.3.2');
assert.strictEqual(packageLock.packages[''].dependencies['firebase-admin'], '^12.7.0');
assert.strictEqual(packageLock.packages['node_modules/firebase-functions'].version, '7.3.2');
assert(firebaseConfig.functions.every((entry) => entry.runtime === 'nodejs22'));

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
assert.match(gitignore, /(?:^|\r?\n)\.firebase\/(?:\r?\n|$)/);
const ignoredCache = spawnSync('git', ['check-ignore', '--no-index', '-q', '.firebase/hosting.cHVibGlj.cache'], {
  cwd: root,
  encoding: 'utf8'
});
assert.strictEqual(ignoredCache.status, 0, ignoredCache.stderr);

const trackedFirebaseArtifacts = spawnSync('git', ['ls-files', '--', '.firebase/'], {
  cwd: root,
  encoding: 'utf8'
});
assert.strictEqual(trackedFirebaseArtifacts.status, 0, trackedFirebaseArtifacts.stderr);
const trackedFirebasePaths = trackedFirebaseArtifacts.stdout.trim().split(/\r?\n/).filter(Boolean);
assert.deepStrictEqual(trackedFirebasePaths, [], 'generated .firebase artifacts must not remain tracked');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

const functionSources = sourceFiles(path.join(functionsDir, 'src'))
  .filter((filePath) => filePath.endsWith('.js'));
assert(functionSources.length > 0);
assert(functionSources.every((filePath) => !fs.readFileSync(filePath, 'utf8').includes('functions.config')));

const sourceDiscovery = spawnSync(process.execPath, ['-e', "require('./src/index.js'); process.stdout.write('index-loaded'); process.exit(0);"], {
  cwd: functionsDir,
  encoding: 'utf8',
  timeout: 30000,
  env: { ...process.env, FIREBASE_CONFIG: '{}' }
});
assert.strictEqual(
  sourceDiscovery.error,
  undefined,
  `source discovery failed to spawn or timed out: ${sourceDiscovery.error?.code || sourceDiscovery.error?.message || 'unknown error'}`
);
assert.strictEqual(sourceDiscovery.signal, null, `source discovery terminated by signal ${sourceDiscovery.signal}`);
assert.strictEqual(sourceDiscovery.status, 0, sourceDiscovery.stderr);
assert.match(sourceDiscovery.stdout, /index-loaded/);

console.log('V4-A2 production-hardening contract passed');
