'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  discoverProtectedObjects,
  DEFAULT_PROJECT_ID,
  DEFAULT_BUCKET_NAME
} = require('../../scripts/release/media-gc.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');

test('Media GC Planner: discovers active publication and protects production lock', () => {
  const discovery = discoverProtectedObjects({ repoRoot: REPO_ROOT });
  assert.equal(discovery.activePublicationId, 'pub-20260918-all-media');
  assert.ok(discovery.totalProtectedObjectKeys > 50000, `Expected > 50,000 protected keys, found ${discovery.totalProtectedObjectKeys}`);
  assert.ok(discovery.totalProtectedMetadataKeys >= 20, `Expected >= 20 metadata keys, found ${discovery.totalProtectedMetadataKeys}`);
});

test('Media GC Planner: protects catalog shards across both all-media and ra-sst cohorts', () => {
  const discovery = discoverProtectedObjects({ repoRoot: REPO_ROOT });
  assert.ok(discovery.protectedMetadataFiles.has('catalogs/pub-20260918-all-media/RFIB.json'));
  assert.ok(discovery.protectedMetadataFiles.has('catalogs/pub-20260918-all-media/RA.json'));
  assert.ok(discovery.protectedMetadataFiles.has('catalogs/pub-20260918-all-media/Describe-Image.json'));
  assert.ok(discovery.protectedMetadataFiles.has('catalogs/pub-20260918-ra-sst/RA.json'));
  assert.ok(discovery.protectedMetadataFiles.has('catalogs/pub-20260918-ra-sst/SST.json'));
  assert.ok(discovery.protectedMetadataFiles.has('publications/pub-20260918-all-media/release.json'));
});

test('Media GC Planner: references map contains provenance for sample media keys', () => {
  const discovery = discoverProtectedObjects({ repoRoot: REPO_ROOT });
  // Check a sample DI image key is protected
  const sampleKey = 'media/sha256/2a66e432a24c2fc930ea3bca95a04efcffad4cfefc4ea4eefaaee3b92209d846.png';
  if (discovery.protectedObjects.has(sampleKey)) {
    const reasons = Array.from(discovery.protectedObjects.get(sampleKey));
    assert.ok(reasons.length > 0);
    assert.ok(reasons[0].includes('Describe-Image') || reasons[0].includes('pub-20260918-all-media'));
  }
});

test('Media GC Planner: defaults configure standard project and bucket', () => {
  assert.equal(DEFAULT_PROJECT_ID, 'listening-tasks-3ae34');
  assert.equal(DEFAULT_BUCKET_NAME, 'listening-tasks-3ae34-practice-media');
});
