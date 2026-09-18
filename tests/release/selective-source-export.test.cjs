'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadReleaseInputPolicy,
  classifyTrackedPath,
  filterTrackedInventoryForProfile
} = require('../../scripts/release/lib/release-input-policy.cjs');

const {
  buildReleaseContext,
  inventorySurface
} = require('../../scripts/release/firebase-release.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');

test('Stage 5a Policy: release-input-policy.json defines profile export policy and omission classifications', () => {
  const policyResult = loadReleaseInputPolicy();
  const { policy } = policyResult;

  assert.ok(policy.profileExportPolicy, 'profileExportPolicy must be defined');
  assert.ok(policy.profileExportPolicy.hosting, 'hosting profile export policy must be defined');
  assert.ok(policy.profileExportPolicy.functions, 'functions profile export policy must be defined');
  assert.ok(policy.profileExportPolicy.full, 'full profile export policy must be defined');

  assert.ok(Array.isArray(policy.omissionClassifications), 'omissionClassifications array must be defined');
  const categories = new Set(policy.omissionClassifications.map(c => c.category));
  assert.ok(categories.has('non-runtime-docs'));
  assert.ok(categories.has('non-runtime-tests'));
  assert.ok(categories.has('non-runtime-assets'));
  assert.ok(categories.has('non-runtime-scratch'));
  assert.ok(categories.has('non-runtime-tooling'));
});

test('Stage 5a Classification: retains 100% of runtime application assets in hosting profile', () => {
  const policyResult = loadReleaseInputPolicy();

  // HTML entrypoints
  assert.equal(classifyTrackedPath('public/index.html', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('public/crm-admin.html', 'hosting', policyResult).status, 'include');

  // Skill icons (mandated by user: being unchanged does not make it optional)
  assert.equal(classifyTrackedPath('public/assets/skill-icons/speaking.svg', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('public/assets/skill-icons/writing.svg', 'hosting', policyResult).status, 'include');

  // Prototypes (mandated by user: keep production behavior unchanged)
  assert.equal(classifyTrackedPath('public/prototypes/test-audio.html', 'hosting', policyResult).status, 'include');

  // Database manifests and workbooks
  assert.equal(classifyTrackedPath('public/database/RA/RA.xlsx', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('public/database/RA/Voice/audio/manifest.json', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('public/database/RFIB/RFIB.xlsx', 'hosting', policyResult).status, 'include');

  // JavaScript runtime assets
  assert.equal(classifyTrackedPath('public/script.js', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('public/js/media-url-resolver.js', 'hosting', policyResult).status, 'include');

  // Build tools and release configuration
  assert.equal(classifyTrackedPath('package.json', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('firebase.json', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('scripts/release/firebase-release.cjs', 'hosting', policyResult).status, 'include');
  assert.equal(classifyTrackedPath('scripts/sync-version.js', 'hosting', policyResult).status, 'include');
});

test('Stage 5a Classification: classifies non-runtime files into explicit omission categories', () => {
  const policyResult = loadReleaseInputPolicy();

  // Documentation
  const doc = classifyTrackedPath('docs/specs/architecture.md', 'hosting', policyResult);
  assert.equal(doc.status, 'omit');
  assert.equal(doc.category, 'non-runtime-docs');

  const slides = classifyTrackedPath('exported_slides/presentation.pptx', 'hosting', policyResult);
  assert.equal(slides.status, 'omit');
  assert.equal(slides.category, 'non-runtime-docs');

  // Tests
  const unitTest = classifyTrackedPath('tests/release/media-gc.test.cjs', 'hosting', policyResult);
  assert.equal(unitTest.status, 'omit');
  assert.equal(unitTest.category, 'non-runtime-tests');

  // Raw assets
  const rawAsset = classifyTrackedPath('assets/mockup.png', 'hosting', policyResult);
  assert.equal(rawAsset.status, 'omit');
  assert.equal(rawAsset.category, 'non-runtime-assets');

  // Scratch / debug
  const scratch = classifyTrackedPath('_tmp_pdf_debug/page1.txt', 'hosting', policyResult);
  assert.equal(scratch.status, 'omit');
  assert.equal(scratch.category, 'non-runtime-scratch');

  // Local tooling
  const tool = classifyTrackedPath('.agent/rules/auto_boost_protocol.md', 'hosting', policyResult);
  assert.equal(tool.status, 'omit');
  assert.equal(tool.category, 'non-runtime-docs');

  const taskTracker = classifyTrackedPath('TASK_TRACKER.csv', 'hosting', policyResult);
  assert.equal(taskTracker.status, 'omit');
  assert.equal(taskTracker.category, 'non-runtime-tooling');

  // Functions backend in hosting profile
  const backend = classifyTrackedPath('functions/index.js', 'hosting', policyResult);
  assert.equal(backend.status, 'omit');
  assert.equal(backend.category, 'backend-functions');
});

test('Stage 5a Inventory Filtering: accurately separates candidate items and records category breakdown', () => {
  const policyResult = loadReleaseInputPolicy();

  const mockInventory = [
    { path: 'public/index.html', size: 1200 },
    { path: 'public/assets/skill-icons/ra.svg', size: 800 },
    { path: 'package.json', size: 500 },
    { path: 'docs/guide.md', size: 10000 },
    { path: 'exported_slides/deck.pptx', size: 5000000 },
    { path: 'tests/unit.test.js', size: 2500 },
    { path: 'functions/api.js', size: 4000 }
  ];

  const result = filterTrackedInventoryForProfile(mockInventory, 'hosting', policyResult);

  assert.equal(result.filtered.length, 3, 'Exactly 3 files retained for hosting candidate');
  assert.equal(result.omittedCount, 4, 'Exactly 4 non-runtime files omitted');
  assert.equal(result.omittedBytes, 10000 + 5000000 + 2500 + 4000);

  assert.ok(result.breakdown['non-runtime-docs']);
  assert.equal(result.breakdown['non-runtime-docs'].count, 2); // docs/guide.md + exported_slides/deck.pdf
  assert.ok(result.breakdown['non-runtime-tests']);
  assert.equal(result.breakdown['non-runtime-tests'].count, 1);
  assert.ok(result.breakdown['backend-functions']);
  assert.equal(result.breakdown['backend-functions'].count, 1);
});

test('Stage 5a Candidate Integration: candidate export omits non-runtime trees while preserving 100% surface equivalence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage5a-export-test-'));

  try {
    const ctx = buildReleaseContext({
      profile: 'hosting',
      verifyOnly: true,
      externalRoot: tempDir,
      selectiveSourceExport: true,
      guardDirty: false
    });

    assert.ok(ctx.candidateRoot, 'candidateRoot must be created');
    assert.ok(ctx.omittedNonRuntimeCount > 0, 'omittedNonRuntimeCount must be recorded');
    assert.ok(ctx.omittedNonRuntimeBytes >= 0, 'omittedNonRuntimeBytes must be a valid number');

    // Verify non-runtime directories were NOT created in candidateRoot
    assert.equal(fs.existsSync(path.join(ctx.candidateRoot, 'exported_slides')), false, 'exported_slides must not exist in candidate');
    assert.equal(fs.existsSync(path.join(ctx.candidateRoot, 'docs', 'specs')), false, 'docs/specs must not exist in candidate');
    assert.equal(fs.existsSync(path.join(ctx.candidateRoot, 'tests')), false, 'tests must not exist in candidate');
    assert.equal(fs.existsSync(path.join(ctx.candidateRoot, '_tmp_pdf_debug')), false, '_tmp_pdf_debug must not exist in candidate');
    assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'docs', 'audits', 'read-aloud-connected-speech', '2026-03-26-coverage', 'coverage.json')), 'coverage.json must be preserved');

    // Verify runtime files ARE present in candidateRoot
    assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'public', 'index.html')), 'public/index.html must exist');
    assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'public', 'assets', 'skill-icons')), 'public/assets/skill-icons must exist');
    assert.ok(fs.existsSync(path.join(ctx.candidateRoot, 'public', 'database', 'RA', 'RA.xlsx')), 'RA.xlsx must exist');

    // Surface inventory must contain all intended application files
    const surface = inventorySurface(ctx);
    assert.ok(surface.length > 100, 'surface must inventory all published application files');
    const surfacePaths = new Set(surface.map(s => s.path));
    assert.ok(surfacePaths.has('index.html') || surfacePaths.has('public/index.html'));

  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});
