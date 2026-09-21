import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { validateVersionOracle } = createRequire(import.meta.url)('../scripts/release/firebase-release.cjs');

test('service worker cache token matches package version', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, new RegExp(`const CACHE_VERSION = 'bel-offline-v${version.replaceAll('.', '\\.')}';`));
});

test('sync and release oracle enforce the service worker version in an isolated candidate', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bel-version-test-'));
  const write = (relative, content) => {
    const destination = path.join(root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  };
  try {
    write('package.json', JSON.stringify({ version: '2.0.13' }));
    write('public/index.html', '<div id="version-indicator" class="version-indicator">V1.0.0</div>');
    write('public/js/lazy-loader.js', "loadScript('/read-aloud-mode.js?v=1.0.0')");
    write('public/sw.js', "const CACHE_VERSION = 'bel-offline-v28-v1-8-128';\n// preserve lifecycle\n");
    for (const name of ['crm-admin.html', 'crm-entrance-test-result.html']) write(`public/${name}`, '?v=20260101-v1.0.0');
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(new URL('../scripts/sync-version.js', import.meta.url), path.join(root, 'scripts/sync-version.js'));
    execFileSync(process.execPath, [path.join(root, 'scripts/sync-version.js'), '--timestamp', '2026-09-20T00:00:00Z']);
    assert.equal(readFileSync(path.join(root, 'public/sw.js'), 'utf8'), "const CACHE_VERSION = 'bel-offline-v2.0.13';\n// preserve lifecycle\n");
    assert.equal(readFileSync(path.join(root, 'public/js/lazy-loader.js'), 'utf8'), "loadScript('/read-aloud-mode.js?v=2.0.13')");
    const ctx = { candidateRoot: root, committerEpoch: Date.parse('2026-09-20T00:00:00Z') / 1000 };
    assert.equal(validateVersionOracle(ctx).version, '2.0.13');
    rmSync(path.join(root, 'public/js/lazy-loader.js'));
    assert.throws(() => validateVersionOracle(ctx), /public\/js\/lazy-loader\.js/);
    write('public/js/lazy-loader.js', "loadScript('/read-aloud-mode.js?v=2.0.13')");
    for (const source of ["const CACHE_VERSION = 'bel-offline-v1.0.0';", '// missing cache token']) {
      write('public/sw.js', source);
      assert.throws(() => validateVersionOracle(ctx), /public\/sw\.js/);
    }
    rmSync(path.join(root, 'public/sw.js'));
    assert.throws(() => validateVersionOracle(ctx), /public\/sw\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Read Aloud mode is lazy loaded with package version token', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const lazyLoader = readFileSync(new URL('../public/js/lazy-loader.js', import.meta.url), 'utf8');

  // Verify eager parser script is removed from index.html
  const eagerMatch = html.match(/<script\s+src="\/read-aloud-mode\.js(?:\?v=[^"]*)?"><\/script>/);
  assert.equal(eagerMatch, null, 'Expected public/index.html to NOT eagerly load read-aloud-mode.js');

  // Verify lazy loader requests the current package version
  const loaderMatch = lazyLoader.match(/loadScript\(['"]\/read-aloud-mode\.js\?v=([^'"]+)['"]\)/);
  assert.ok(loaderMatch, 'Expected public/js/lazy-loader.js to load read-aloud-mode.js with a cache token');
  assert.strictEqual(loaderMatch[1], packageJson.version, 'Lazy loader cache token must match package version');
});
