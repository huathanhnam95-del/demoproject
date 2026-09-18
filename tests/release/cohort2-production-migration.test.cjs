'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadReleaseInputPolicy,
  resolveExcludedPaths,
  resolveExcludedRoots,
  filterTrackedInventory,
  validatePublicationEligibility
} = require('../../scripts/release/lib/release-input-policy.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');

test('Production Cohort 2 Policy: cohort-all-media is configured and production-eligible', () => {
  const policyResult = loadReleaseInputPolicy();
  assert.ok(policyResult.policy.cohorts['cohort-all-media'], 'cohort-all-media must be defined');
  const cohort = policyResult.policy.cohorts['cohort-all-media'];
  assert.equal(cohort.productionEligible, true, 'cohort-all-media must be marked productionEligible: true');
  assert.equal(cohort.publicationId, 'pub-20260918-all-media');
  assert.ok(Array.isArray(cohort.roots), 'cohort roots must be an array');
  assert.equal(cohort.roots.length, 21, 'cohort roots must contain all 21 media roots');
  assert.ok(cohort.roots.includes('public/database/RA/Voice/audio'));
  assert.ok(cohort.roots.includes('public/database/SST/audio'));
  assert.ok(cohort.roots.includes('public/database/RFIB/audio'));
  assert.ok(cohort.roots.includes('public/database/Highlight Incorrect Words/audio'));
  assert.ok(cohort.roots.includes('public/database/Take Notes/RL/audio'));
  assert.ok(cohort.roots.includes('public/database/collo-dictate/audio'));
  assert.ok(cohort.roots.includes('public/database/Describe Image/DI'));
  assert.ok(cohort.roots.includes('public/database/type/audio'));
  assert.ok(cohort.roots.includes('public/database/speak/audio'));
});

test('Production Cohort 2 Policy: resolveExcludedPaths succeeds in production mode without throwing PILOT_MEDIA_INELIGIBLE', () => {
  const policyResult = loadReleaseInputPolicy();
  let excluded;
  assert.doesNotThrow(() => {
    excluded = resolveExcludedPaths(policyResult, {
      cohort: 'cohort-all-media',
      isProduction: true,
      allowPilot: false,
      projectRoot: REPO_ROOT
    });
  });
  assert.equal(excluded.size, 52888, 'Should resolve all 52,888 practice media assets across 20 modes');
});

test('Production Cohort 2 Policy: resolveExcludedRoots extracts all 21 directory prefixes for fast skipping', () => {
  const policyResult = loadReleaseInputPolicy();
  const roots = resolveExcludedRoots(policyResult, { cohort: 'cohort-all-media' });
  assert.equal(roots.size, 21);
  assert.ok(roots.has('public/database/RA/Voice/audio'));
  assert.ok(roots.has('public/database/Describe Image/DI'));
  assert.ok(roots.has('public/database/RFIB/audio'));
  assert.ok(roots.has('public/database/collo-dictate/audio'));
  assert.ok(roots.has('public/database/echo-forge/audio'));
});

test('Production Cohort 2 Policy: Protected builder inputs are never excluded', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, {
    cohort: 'cohort-all-media',
    isProduction: true,
    projectRoot: REPO_ROOT
  });

  // Protected inputs must never be present in excluded set
  for (const protectedPath of policyResult.protectedSet) {
    assert.equal(
      excluded.has(protectedPath),
      false,
      `Protected input '${protectedPath}' must NOT be in the excluded set`
    );
  }

  assert.equal(excluded.has('public/database/RA/RA.xlsx'), false);
  assert.equal(excluded.has('public/database/Describe Image/DI.xlsx'), false);
  assert.equal(excluded.has('public/database/RFIB/RFIB.xlsx'), false);
  assert.equal(excluded.has('public/database/Highlight Incorrect Words/HIW/HIW.xlsx'), false);
  assert.equal(excluded.has('public/database/type/WFD.xlsx'), false);
  assert.equal(excluded.has('public/database/speak/RS.xlsx'), false);
  assert.equal(excluded.has('public/database/RTS/rts_questions.json'), false);
  assert.equal(excluded.has('public/database/echo-forge/challenges.v1.json'), false);
});

test('Production Publication Lock Validation: accepts production pub-20260918-all-media', () => {
  const lockPath = path.join(REPO_ROOT, 'config/media-release.lock.json');
  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  assert.equal(lockData.publicationId, 'pub-20260918-all-media');
  assert.equal(lockData.ineligibleForProduction, false);
  assert.deepEqual(lockData.activeCohorts, ['cohort-all-media']);
  assert.equal(Object.keys(lockData.modes).length, 20, 'All 20 modes must be configured');

  assert.doesNotThrow(() => {
    validatePublicationEligibility(lockData, { isProduction: true, allowPilot: false });
  });
});

test('Production Cohort 2 Catalogs: 100% complete and well-formed (52,888 total assets across 20 shards)', () => {
  const releasePath = path.join(REPO_ROOT, 'public/publications/pub-20260918-all-media/release.json');
  assert.ok(fs.existsSync(releasePath), 'release.json manifest must exist');
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));

  assert.equal(release.publicationId, 'pub-20260918-all-media');
  assert.equal(release.ineligibleForProduction, false);
  assert.equal(release.summary.totalLogicalAssets, 52888);
  assert.equal(release.summary.modesCount, 20);

  const expectedModes = [
    ['RA', 30681],
    ['SST', 1755],
    ['RFIB', 4001],
    ['HIW', 1059],
    ['Take-Notes', 426],
    ['collo-dictate', 3765],
    ['Describe-Image', 1204],
    ['LMCMA', 210],
    ['LMCSA', 261],
    ['HCS', 180],
    ['type', 3182],
    ['SMW', 267],
    ['speak', 2830],
    ['extended', 232],
    ['LFIB', 232],
    ['SGD', 81],
    ['quiz', 2344],
    ['RTS', 146],
    ['Entrance-Test', 2],
    ['echo-forge', 30]
  ];

  let sumAssets = 0;
  for (const [mode, expectedCount] of expectedModes) {
    assert.ok(release.shards[mode], `Shard for mode ${mode} must exist in release.json`);
    const shardPath = path.join(REPO_ROOT, 'public', release.shards[mode].shardKey);
    assert.ok(fs.existsSync(shardPath), `Catalog file ${shardPath} must exist on disk`);
    const shardData = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    const assetKeys = Object.keys(shardData.assets || {});
    assert.equal(assetKeys.length, expectedCount, `Mode ${mode} asset count must be ${expectedCount}`);
    sumAssets += assetKeys.length;
  }
  assert.equal(sumAssets, 52888);
});

test('Production Cohort 2 Client Resolver: remote-only mode throws defect on unmapped asset without local fallback', async () => {
  require('../../public/js/media-url-resolver.js');
  const MediaUrlResolver = globalThis.MediaUrlResolver;
  MediaUrlResolver._reset();

  const manifestPath = path.join(REPO_ROOT, 'public/media-release.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Pre-populate shards in cache from disk
  const diShard = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/catalogs/pub-20260918-all-media/Describe-Image.json'), 'utf8'));
  const rfibShard = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/catalogs/pub-20260918-all-media/RFIB.json'), 'utf8'));
  MediaUrlResolver._getShardCache().set('Describe-Image', diShard);
  MediaUrlResolver._getShardCache().set('RFIB', rfibShard);

  // Successfully resolves mapped DI image asset
  const diSamplePath = '/database/Describe Image/DI/1.png';
  const resolvedImageUrl = await MediaUrlResolver.resolveImageUrl(diSamplePath, {
    config: manifest,
    mode: 'Describe-Image',
    rolloutState: 'remote-only'
  });
  assert.ok(resolvedImageUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
  assert.ok(resolvedImageUrl.endsWith('.png'));

  // Successfully resolves mapped RFIB audio asset
  const rfibSamplePath = '/database/RFIB/audio/0001_Full_F_100.mp3';
  const resolvedAudioUrl = await MediaUrlResolver.resolveAudioUrl(rfibSamplePath, {
    config: manifest,
    mode: 'RFIB',
    rolloutState: 'remote-only'
  });
  assert.ok(resolvedAudioUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
  assert.ok(resolvedAudioUrl.endsWith('.mp3'));

  // Unmapped asset MUST throw rather than fall back to legacy path
  const unmappedPath = '/database/RFIB/audio/non-existent-sample-file-404.mp3';
  await assert.rejects(
    async () => {
      await MediaUrlResolver.resolveAudioUrl(unmappedPath, {
        config: manifest,
        mode: 'RFIB',
        rolloutState: 'remote-only'
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Remote resolution failed in remote-only mode/i);
      return true;
    }
  );
});
