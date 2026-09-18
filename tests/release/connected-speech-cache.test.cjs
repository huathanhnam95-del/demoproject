'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const {
  buildConnectedSpeechIndex,
  computeConnectedSpeechFingerprint,
  readAnalysisCache,
  writeAnalysisCache,
  CACHE_SCHEMA_VERSION
} = require(path.join(REPO_ROOT, 'scripts/read-aloud/connected-speech-index-core.js'));

test('Stage 5c Fingerprint: changes when source workbook or manifests change', () => {
  const fp1 = computeConnectedSpeechFingerprint();
  assert.equal(typeof fp1, 'string');
  assert.equal(fp1.length, 64);

  // Invalidation when indexVersion changes
  const fp2 = computeConnectedSpeechFingerprint({ indexVersion: '2-custom' });
  assert.notEqual(fp1, fp2, 'Fingerprint must change when indexVersion changes');

  // Invalidation when workbook path or contents change
  const fp3 = computeConnectedSpeechFingerprint({ workbookPath: path.join(REPO_ROOT, 'package.json') });
  assert.notEqual(fp1, fp3, 'Fingerprint must change when workbook source changes');
});

test('Stage 5c Equivalence: cached build produces byte-identical outputs at same timestamp', async () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp-cache-test-'));
  try {
    const cacheDir = path.join(tmpDir, 'cache');
    const outDir1 = path.join(tmpDir, 'run1');
    const outDir2 = path.join(tmpDir, 'run2');

    const timestamp = '2026-09-18T18:30:00.000Z';

    const opts1 = {
      cacheDir,
      publicIndexPath: path.join(outDir1, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDir1, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDir1, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDir1, 'coverage'),
      generatedAt: timestamp
    };

    const res1 = await buildConnectedSpeechIndex(opts1);
    assert.equal(res1.cacheHit, false, 'First run must be a cache miss');

    const opts2 = {
      cacheDir,
      publicIndexPath: path.join(outDir2, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDir2, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDir2, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDir2, 'coverage'),
      generatedAt: timestamp
    };

    const res2 = await buildConnectedSpeechIndex(opts2);
    assert.equal(res2.cacheHit, true, 'Second run must be a cache hit');

    // Compare generated files byte-for-byte
    for (const filename of ['connected-speech-index.json', 'connected-speech-featured-prompts.json', 'read-aloud-connected-speech-index.json']) {
      const b1 = fs.readFileSync(path.join(outDir1, filename));
      const b2 = fs.readFileSync(path.join(outDir2, filename));
      assert.deepEqual(b1, b2, `${filename} must be byte-identical between cold and cached runs`);
    }

    const cov1 = fs.readFileSync(path.join(outDir1, 'coverage', 'coverage.json'));
    const cov2 = fs.readFileSync(path.join(outDir2, 'coverage', 'coverage.json'));
    assert.deepEqual(cov1, cov2, 'coverage.json must be byte-identical');

    const sum1 = fs.readFileSync(path.join(outDir1, 'coverage', 'summary.md'));
    const sum2 = fs.readFileSync(path.join(outDir2, 'coverage', 'summary.md'));
    assert.deepEqual(sum1, sum2, 'summary.md must be byte-identical');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Stage 5c Timestamp Rendering: new release timestamp correctly serializes into cached output', async () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp-ts-test-'));
  try {
    const cacheDir = path.join(tmpDir, 'cache');
    const outDir1 = path.join(tmpDir, 'run1');
    const outDir2 = path.join(tmpDir, 'run2');

    const ts1 = '2026-09-18T12:00:00.000Z';
    const ts2 = '2026-09-18T19:45:00.000Z';

    const res1 = await buildConnectedSpeechIndex({
      cacheDir,
      publicIndexPath: path.join(outDir1, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDir1, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDir1, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDir1, 'coverage'),
      generatedAt: ts1
    });

    const res2 = await buildConnectedSpeechIndex({
      cacheDir,
      publicIndexPath: path.join(outDir2, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDir2, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDir2, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDir2, 'coverage'),
      generatedAt: ts2
    });

    assert.equal(res1.index.generatedAt, ts1);
    assert.equal(res2.index.generatedAt, ts2);
    assert.equal(res2.cacheHit, true, 'Second run must hit cache despite newer release timestamp');

    // Verify metadata inside the written files
    const file1 = JSON.parse(fs.readFileSync(path.join(outDir1, 'connected-speech-index.json'), 'utf8'));
    const file2 = JSON.parse(fs.readFileSync(path.join(outDir2, 'connected-speech-index.json'), 'utf8'));
    assert.equal(file1.generatedAt, ts1);
    assert.equal(file2.generatedAt, ts2);
    assert.deepEqual(file1.prompts, file2.prompts, 'Prompt analyses must be identical across timestamps');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Stage 5c Corruption Recovery: corrupted or invalid cache file triggers clean recomputation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp-corrupt-test-'));
  try {
    const cacheDir = path.join(tmpDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    const fp = computeConnectedSpeechFingerprint();
    const cacheFile = path.join(cacheDir, `${fp}.json`);

    // Write corrupted JSON
    fs.writeFileSync(cacheFile, '{ corrupted json payload: [1, 2, ...', 'utf8');

    const outDir = path.join(tmpDir, 'out');
    const res = await buildConnectedSpeechIndex({
      cacheDir,
      publicIndexPath: path.join(outDir, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDir, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDir, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDir, 'coverage'),
      generatedAt: '2026-09-18T15:00:00.000Z'
    });

    assert.equal(res.cacheHit, false, 'Must recover from corrupt cache by falling back to full compute');
    assert.equal(Array.isArray(res.index.prompts), true, 'Prompts must be successfully computed');

    // Verify valid cache was rewritten
    const healed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(healed.fingerprint, fp);
    assert.equal(Array.isArray(healed.prompts), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});