'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadReleaseInputPolicy,
  resolveExcludedPaths,
  filterTrackedInventory,
  validatePublicationEligibility
} = require('../../scripts/release/lib/release-input-policy.cjs');

const {
  buildReleaseContext,
  runRelease,
  captureObservedProvisionedAssets,
  ReleaseMetrics
} = require('../../scripts/release/firebase-release.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');

test('Selective Exclusion Controller: loads default release input policy schema and protected inputs', () => {
  const policyResult = loadReleaseInputPolicy();
  assert.ok(policyResult.policy);
  assert.equal(policyResult.policy.schemaVersion, 1);
  assert.ok(policyResult.policySha256);
  assert.ok(policyResult.protectedSet.has('public/database/RA/RA.xlsx'));
  assert.ok(policyResult.protectedSet.has('public/database/RA/Voice/audio/manifest.json'));
  assert.ok(policyResult.protectedSet.has('public/database/RA/connected-speech-index.json'));
  assert.ok(policyResult.protectedSet.has('public/database/SST/SST/SST.xlsx'));
  assert.ok(policyResult.protectedSet.has('public/media-release.json'));
  assert.ok(policyResult.protectedSet.has('config/media-release.lock.json'));
});

test('Test 1: Unchanged default release output when no cohort is active (100% legacy parity)', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, {});
  assert.equal(excluded.size, 0);

  const mockInventory = [
    { path: 'public/index.html', size: 100 },
    { path: 'public/database/RA/RA.xlsx', size: 5000 },
    { path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3', size: 400000 }
  ];

  const result = filterTrackedInventory(mockInventory, excluded);
  assert.equal(result.filtered.length, 3);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.excludedCount, 0);
  assert.equal(result.avoidedBytes, 0);
});

test('Test 2: Production release with pilot publication strictly fails with PILOT_MEDIA_INELIGIBLE', () => {
  const pilotLock = {
    schemaVersion: 1,
    environment: 'production',
    publicationId: 'pilot-20260918-035318',
    ineligibleForProduction: true
  };

  // Production check without allowPilot MUST throw PILOT_MEDIA_INELIGIBLE
  assert.throws(() => {
    validatePublicationEligibility(pilotLock, { isProduction: true, allowPilot: false });
  }, (err) => {
    assert.equal(err.code, 'PILOT_MEDIA_INELIGIBLE');
    assert.match(err.message, /ineligible for production/i);
    return true;
  });

  // Non-production or test run with allowPilot MUST succeed
  assert.doesNotThrow(() => {
    validatePublicationEligibility(pilotLock, { isProduction: true, allowPilot: true });
  });
  assert.doesNotThrow(() => {
    validatePublicationEligibility(pilotLock, { isProduction: false, allowPilot: false });
  });

  // Cohort level production eligibility check
  const policyResult = loadReleaseInputPolicy();
  assert.throws(() => {
    resolveExcludedPaths(policyResult, { cohort: 'pilot-cohort', isProduction: true, allowPilot: false });
  }, (err) => {
    assert.equal(err.code, 'PILOT_MEDIA_INELIGIBLE');
    return true;
  });

  // Allowed when allowPilot: true
  const allowedExcluded = resolveExcludedPaths(policyResult, { cohort: 'pilot-cohort', isProduction: true, allowPilot: true });
  assert.equal(allowedExcluded.size, 26);
});

test('Test 3: Isolated run with allowPilot: true excludes exact 26 pilot files before export', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, { cohort: 'pilot-cohort', isProduction: true, allowPilot: true });
  assert.equal(excluded.size, 26);

  // Check sample pilot paths are in the exclusion set
  assert.ok(excluded.has('public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3'));
  assert.ok(excluded.has('public/database/Describe Image/DI/1.png'));
  assert.ok(excluded.has('public/database/Highlight Incorrect Words/audio/1/HIW_1_af_bella.mp3'));
  assert.ok(excluded.has('public/database/SST/audio/1/SST_1_bm_lewis.mp3'));

  const mockInventory = [
    { path: 'public/index.html', size: 1000 },
    { path: 'public/database/RA/RA.xlsx', size: 2000 },
    { path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3', size: 407510 },
    { path: 'public/database/Describe Image/DI/1.png', size: 234120 }
  ];

  const result = filterTrackedInventory(mockInventory, excluded);
  assert.equal(result.filtered.length, 2);
  assert.equal(result.filtered[0].path, 'public/index.html');
  assert.equal(result.filtered[1].path, 'public/database/RA/RA.xlsx');
  assert.equal(result.excluded.length, 2);
  assert.equal(result.excludedCount, 2);
  assert.equal(result.avoidedBytes, 407510 + 234120);
});

test('Test 4: Preserved builder inputs are protected and can never be excluded', () => {
  const policyResult = loadReleaseInputPolicy();

  // Attempting to exclude protected inputs must throw
  const badPolicyResult = {
    policy: {
      schemaVersion: 1,
      cohorts: {
        'malicious-cohort': {
          productionEligible: true,
          assets: ['public/database/RA/RA.xlsx']
        }
      }
    },
    protectedSet: policyResult.protectedSet
  };

  assert.throws(() => {
    resolveExcludedPaths(badPolicyResult, { cohort: 'malicious-cohort', isProduction: false });
  }, /Cannot exclude protected builder input/i);
});

test('Test 5: Auto-provisioning does not re-add untracked pilot files from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-prov-test-'));
  try {
    const audioDir = path.join(tempDir, 'public/database/RA/Voice/audio/Audio by folder/1');
    fs.mkdirSync(audioDir, { recursive: true });

    const excludedFile = path.join(audioDir, 'RA_1_af_alloy_100.mp3');
    fs.writeFileSync(excludedFile, 'dummy audio data');

    const includedFile = path.join(audioDir, 'RA_1_other_voice.mp3');
    fs.writeFileSync(includedFile, 'other dummy audio data');

    const excludedPaths = new Set(['public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3']);
    const observed = captureObservedProvisionedAssets(tempDir, [], {
      mediaRoots: path.join(tempDir, 'public'),
      excludedPaths
    });

    const observedRelPaths = observed.map((o) => o.targetPath.replace(/\\/g, '/'));
    assert.ok(!observedRelPaths.includes('public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3'), 'Excluded media must not be captured');
    assert.ok(observedRelPaths.includes('public/database/RA/Voice/audio/Audio by folder/1/RA_1_other_voice.mp3'), 'Non-excluded media must still be captured');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Test 6: Absent local files for externalized media do not cause release failure', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, { cohort: 'pilot-cohort', allowPilot: true, isProduction: false });

  // Inventory where the excluded file is present in git index, but doesn't exist on disk
  const inventory = [
    { path: 'public/index.html', size: 100 },
    { path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3', size: 407510 }
  ];

  const { filtered, excludedCount, avoidedBytes } = filterTrackedInventory(inventory, excluded);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].path, 'public/index.html');
  assert.equal(excludedCount, 1);
  assert.equal(avoidedBytes, 407510);
});

test('Test 7: Release metrics report exact avoided file count (26) and avoided bytes (10,525,202)', () => {
  const policyResult = loadReleaseInputPolicy();
  const excluded = resolveExcludedPaths(policyResult, { cohort: 'pilot-cohort', allowPilot: true, isProduction: false });

  const { inspectPilotAssets } = require('../../scripts/release/pilot-media-campaign.cjs');
  const baseDir = fs.existsSync('C:/Cursor AI') ? 'C:/Cursor AI' : REPO_ROOT;
  const pilotData = inspectPilotAssets(baseDir);
  const mockInventory = pilotData.items.map((item) => ({
    path: item.logicalPath,
    size: item.size
  }));

  const result = filterTrackedInventory(mockInventory, excluded);
  assert.equal(result.excludedCount, 26);
  assert.equal(result.avoidedBytes, 10525202);
});

test('Test 8: Full buildReleaseContext integration with allowPilot: true excludes pilot files from candidate', () => {
  const metrics = new ReleaseMetrics({ profile: 'hosting' });
  const ctx = buildReleaseContext({
    profile: 'hosting',
    cohort: 'pilot-cohort',
    allowPilot: true,
    guardDirty: false,
    metrics
  });

  assert.ok(ctx.candidateRoot);
  assert.equal(ctx.activeCohorts.length, 1);
  assert.equal(ctx.activeCohorts[0], 'pilot-cohort');
  assert.equal(ctx.excludedPaths.size, 26);
  assert.ok(ctx.excludedMediaCount > 0);
  assert.ok(ctx.avoidedMediaBytes > 0);

  // Assert all 26 excluded files are absent from ctx.candidateRoot
  for (const excludedPath of ctx.excludedPaths) {
    const candidateFilePath = path.join(ctx.candidateRoot, ...excludedPath.split('/'));
    assert.equal(fs.existsSync(candidateFilePath), false, `Excluded file ${excludedPath} must not exist in candidate`);
  }

  // Assert protected builder inputs ARE present in candidateRoot
  assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'public/database/RA/RA.xlsx')));
  assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'public/database/RA/Voice/audio/manifest.json')));
  assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'public/database/RA/connected-speech-index.json')));

  // Clean up candidate
  if (ctx.cleanup) ctx.cleanup();
});
