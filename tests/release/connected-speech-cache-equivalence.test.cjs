'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const {
  buildConnectedSpeechIndex,
  computeConnectedSpeechFingerprint
} = require(path.join(REPO_ROOT, 'scripts/read-aloud/connected-speech-index-core.js'));

test('Connected-Speech Cache Equivalence: cold MISS, warm HIT, and corrupt REBUILT produce byte-identical outputs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp-cache-equiv-'));
  try {
    const cacheDir = path.join(tmpDir, 'cache');
    const outDirCold = path.join(tmpDir, 'cold');
    const outDirWarm = path.join(tmpDir, 'warm');
    const outDirRebuilt = path.join(tmpDir, 'rebuilt');

    const fixedTimestamp = '2026-09-19T05:00:00.000Z';

    // 1. Cold Run (MISS)
    const resCold = await buildConnectedSpeechIndex({
      cacheDir,
      publicIndexPath: path.join(outDirCold, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDirCold, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDirCold, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDirCold, 'coverage'),
      generatedAt: fixedTimestamp
    });

    assert.equal(resCold.cacheHit, false, 'Cold run must be a cache miss');
    assert.equal(resCold.analysisCache, 'MISS', 'analysisCache metric must report MISS on cold run');
    assert.equal(resCold.analysisCacheReason, 'entry_missing', 'analysisCacheReason must report entry_missing');
    assert.ok(resCold.analysisDurationMs >= 0, 'analysisDurationMs must be positive');

    const fp = computeConnectedSpeechFingerprint();
    const cacheFile = path.join(cacheDir, `${fp}.json`);
    assert.ok(fs.existsSync(cacheFile), 'Cache file must be created after cold run');

    // 2. Warm Run (HIT)
    const resWarm = await buildConnectedSpeechIndex({
      cacheDir,
      publicIndexPath: path.join(outDirWarm, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDirWarm, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDirWarm, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDirWarm, 'coverage'),
      generatedAt: fixedTimestamp
    });

    assert.equal(resWarm.cacheHit, true, 'Warm run must be a cache hit');
    assert.equal(resWarm.analysisCache, 'HIT', 'analysisCache metric must report HIT on warm run');
    assert.equal(resWarm.analysisCacheReason, 'fingerprint_match', 'analysisCacheReason must report fingerprint_match');
    assert.ok(resWarm.analysisDurationMs >= 0, 'analysisDurationMs must be positive');

    // Compare Cold vs Warm byte-for-byte
    const expectedFiles = [
      'connected-speech-index.json',
      'connected-speech-featured-prompts.json',
      'read-aloud-connected-speech-index.json',
      path.join('coverage', 'coverage.json'),
      path.join('coverage', 'summary.md')
    ];

    for (const relFile of expectedFiles) {
      const bCold = fs.readFileSync(path.join(outDirCold, relFile));
      const bWarm = fs.readFileSync(path.join(outDirWarm, relFile));
      assert.deepEqual(bWarm, bCold, `${relFile} must be byte-identical between cold and warm runs`);
    }

    // 3. Corrupt-Cache Recovery Run (REBUILT)
    // Inject corrupt JSON into cache file
    fs.writeFileSync(cacheFile, '{ "corrupted": true, broken_json: [ ', 'utf8');

    const resRebuilt = await buildConnectedSpeechIndex({
      cacheDir,
      publicIndexPath: path.join(outDirRebuilt, 'connected-speech-index.json'),
      featuredPromptsPath: path.join(outDirRebuilt, 'connected-speech-featured-prompts.json'),
      functionsIndexPath: path.join(outDirRebuilt, 'read-aloud-connected-speech-index.json'),
      coverageDir: path.join(outDirRebuilt, 'coverage'),
      generatedAt: fixedTimestamp
    });

    assert.equal(resRebuilt.cacheHit, false, 'Recovery run must report cacheHit false');
    assert.equal(resRebuilt.analysisCache, 'REBUILT', 'analysisCache metric must report REBUILT on corrupt cache');
    assert.equal(resRebuilt.analysisCacheReason, 'corrupt_json', 'analysisCacheReason must report corrupt_json');
    assert.ok(resRebuilt.analysisDurationMs >= 0, 'analysisDurationMs must be positive');

    // Compare Cold vs Rebuilt byte-for-byte
    for (const relFile of expectedFiles) {
      const bCold = fs.readFileSync(path.join(outDirCold, relFile));
      const bRebuilt = fs.readFileSync(path.join(outDirRebuilt, relFile));
      assert.deepEqual(bRebuilt, bCold, `${relFile} must be byte-identical between cold and rebuilt recovery runs`);
    }

    // Verify self-healed cache file is valid JSON now
    const healedContent = fs.readFileSync(cacheFile, 'utf8');
    const parsedHealed = JSON.parse(healedContent);
    assert.equal(parsedHealed.fingerprint, fp);
    assert.ok(Array.isArray(parsedHealed.prompts));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
