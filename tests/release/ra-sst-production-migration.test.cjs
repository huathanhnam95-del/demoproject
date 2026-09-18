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

test('Production Cohort 1 Policy: cohort-ra-sst is configured and production-eligible', () => {
  const policyResult = loadReleaseInputPolicy();
  assert.ok(policyResult.policy.cohorts['cohort-ra-sst'], 'cohort-ra-sst must be defined');
  const cohort = policyResult.policy.cohorts['cohort-ra-sst'];
  assert.equal(cohort.productionEligible, true, 'cohort-ra-sst must be marked productionEligible: true');
  assert.equal(cohort.publicationId, 'pub-20260918-ra-sst');
  assert.ok(Array.isArray(cohort.roots), 'cohort roots must be an array');
  assert.ok(cohort.roots.includes('public/database/RA/Voice/audio'));
  assert.ok(cohort.roots.includes('public/database/SST/audio'));
});

test('Production Cohort 1 Policy: resolveExcludedPaths succeeds in production mode without throwing PILOT_MEDIA_INELIGIBLE', () => {
  const policyResult = loadReleaseInputPolicy();
  assert.doesNotThrow(() => {
    resolveExcludedPaths(policyResult, {
      cohort: 'cohort-ra-sst',
      isProduction: true,
      allowPilot: false,
      projectRoot: REPO_ROOT
    });
  });
});

test('Production Cohort 1 Policy: resolveExcludedRoots extracts directory prefixes for fast skipping', () => {
  const policyResult = loadReleaseInputPolicy();
  const roots = resolveExcludedRoots(policyResult, { cohort: 'cohort-ra-sst' });
  assert.ok(roots.has('public/database/RA/Voice/audio'));
  assert.ok(roots.has('public/database/RA/speech-coach-audio/v1/clips'));
  assert.ok(roots.has('public/database/SST/audio'));
});

test('Production Cohort 1 Policy: Protected builder inputs are never excluded', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, {
    cohort: 'cohort-ra-sst',
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
  assert.equal(excluded.has('public/database/RA/Voice/audio/manifest.json'), false);
  assert.equal(excluded.has('public/database/RA/connected-speech-index.json'), false);
  assert.equal(excluded.has('public/database/SST/SST/SST.xlsx'), false);
  assert.equal(excluded.has('public/database/SST/audio/manifest.json'), false);
});

test('Production Publication Lock Validation: rejects pilot lock but accepts production pub-20260918-ra-sst', () => {
  const pilotLock = {
    publicationId: 'pilot-20260918-035318',
    ineligibleForProduction: true
  };
  assert.throws(() => {
    validatePublicationEligibility(pilotLock, { isProduction: true, allowPilot: false });
  }, (err) => {
    assert.equal(err.code, 'PILOT_MEDIA_INELIGIBLE');
    return true;
  });

  const prodLock = {
    publicationId: 'pub-20260918-ra-sst',
    ineligibleForProduction: false
  };
  assert.doesNotThrow(() => {
    validatePublicationEligibility(prodLock, { isProduction: true, allowPilot: false });
  });
});

test('Production Cohort 1 Catalogs: 100% complete and well-formed (30,681 RA, 1,755 SST)', () => {
  const raShardPath = path.join(REPO_ROOT, 'public/catalogs/pub-20260918-ra-sst/RA.json');
  const sstShardPath = path.join(REPO_ROOT, 'public/catalogs/pub-20260918-ra-sst/SST.json');
  const releasePath = path.join(REPO_ROOT, 'public/publications/pub-20260918-ra-sst/release.json');

  assert.ok(fs.existsSync(raShardPath), 'RA.json catalog must exist');
  assert.ok(fs.existsSync(sstShardPath), 'SST.json catalog must exist');
  assert.ok(fs.existsSync(releasePath), 'release.json must exist');

  const raCatalog = JSON.parse(fs.readFileSync(raShardPath, 'utf8'));
  const sstCatalog = JSON.parse(fs.readFileSync(sstShardPath, 'utf8'));
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));

  assert.equal(raCatalog.assetCount, 30681);
  assert.equal(Object.keys(raCatalog.assets).length, 30681);
  assert.equal(sstCatalog.assetCount, 1755);
  assert.equal(Object.keys(sstCatalog.assets).length, 1755);
  assert.equal(release.ineligibleForProduction, false);

  // Spot-check assets have key, sha256, and size
  const sampleRa = raCatalog.assets['public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3'];
  assert.ok(sampleRa);
  assert.ok(sampleRa.key.startsWith('media/sha256/'));
  assert.ok(sampleRa.sha256);
  assert.equal(sampleRa.size, 255788);

  const sampleSst = sstCatalog.assets['public/database/SST/audio/1/SST_1_af_bella.mp3'];
  assert.ok(sampleSst);
  assert.ok(sampleSst.key.startsWith('media/sha256/'));
  assert.ok(sampleSst.sha256);
  assert.equal(sampleSst.size, 1165100);
});

test('Production Cohort 1 Filtering: filterTrackedInventory avoids exactly 32,436 assets', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, {
    cohort: 'cohort-ra-sst',
    isProduction: true,
    projectRoot: REPO_ROOT
  });
  assert.equal(excluded.size, 32436);

  // Sample inventory with mixed files
  const mockInventory = [
    { path: 'public/index.html', size: 1000 },
    { path: 'public/database/RA/RA.xlsx', size: 2000 },
    { path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3', size: 255788 },
    { path: 'public/database/SST/audio/1/SST_1_af_bella.mp3', size: 1165100 }
  ];

  const result = filterTrackedInventory(mockInventory, excluded);
  assert.equal(result.filtered.length, 2);
  assert.equal(result.filtered[0].path, 'public/index.html');
  assert.equal(result.filtered[1].path, 'public/database/RA/RA.xlsx');
  assert.equal(result.excludedCount, 2);
  assert.equal(result.avoidedBytes, 255788 + 1165100);
});

test('Production Cohort 1 Client Resolver: remote-only mode throws defect on unmapped asset without local fallback', async () => {
  require('../../public/js/media-url-resolver.js');
  const MediaUrlResolver = globalThis.MediaUrlResolver;
  MediaUrlResolver._reset();

  const mockConfig = {
    schemaVersion: 1,
    publicationId: 'pub-20260918-ra-sst',
    deliveryBaseUrl: 'https://storage.googleapis.com/listening-tasks-3ae34-practice-media/',
    defaultRolloutState: 'remote-only',
    modes: {
      RA: {
        state: 'remote-only',
        shardKey: 'catalogs/pub-20260918-ra-sst/RA.json'
      }
    }
  };

  // Pre-populate shard in cache
  const raShard = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/catalogs/pub-20260918-ra-sst/RA.json'), 'utf8'));
  MediaUrlResolver._getShardCache().set('RA', raShard);

  // Mapped asset resolves directly to GCS URL
  const resolved = await MediaUrlResolver.resolveAudioUrl(
    '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3',
    { config: mockConfig }
  );
  assert.ok(resolved.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/0ac3e88e6e516eac81c9cf2202b35398da0ec39bf0ddd841954d6dd4498115f6.mp3'));

  // Unmapped asset MUST throw rather than fall back to legacy path
  await assert.rejects(
    () => MediaUrlResolver.resolveAudioUrl('/database/RA/Voice/audio/Audio by folder/9999/unmapped.mp3', { config: mockConfig }),
    (err) => {
      assert.match(err.message, /Remote resolution failed in remote-only mode/i);
      return true;
    }
  );
});
