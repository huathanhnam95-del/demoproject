'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedSha256 = relative => sha256(read(relative).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));

test('candidate Firestore rules are the compiled live-preserving merge', () => {
  const rules = read('firestore.rules');
  assert.equal(normalizedSha256('firestore.rules'), 'c42d3fdccbc285e8b366b972688dd9bfc1b26838e14847d8cb1a68b2ca6972d5');
  assert.match(rules, /match \/entranceTestUiAnnotations\/demo-d\/items\/\{annotationId\}/);
  for (const collection of ['crmPresentationPresenterLocks', 'crmPresentationRoomCodes', 'crmPresentationRooms', 'crmPresentationOperations', 'crmPresentationArchives', 'crmPresentationEvents']) {
    assert.match(rules, new RegExp(`match /${collection}/`), `missing BEL namespace ${collection}`);
  }
});

test('Realtime Database root placement uses one reviewed exact governance exception', () => {
  const policy = JSON.parse(read('scripts/structure/policy.json'));
  assert.equal(policy.rootEntries.some(entry => (entry.path || entry) === 'database.rules.json'), false);
  const matches = policy.exceptions.filter(entry => entry.path === 'database.rules.json' && entry.ruleId === 'R1.ROOT_ENTRY');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].approval, 'Codex task 01a09a56-d502-76a3-96b9-570d0cc26cd6');
  for (const key of ['owner', 'rationale', 'evidence', 'reviewDate']) assert.ok(matches[0][key], `exception ${key} is required`);
});

test('gateway image has an exact small Docker context contract', () => {
  const manifest = JSON.parse(read('scripts/bel-demo/release-remediation-manifest.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.gatewayContext.maxBytes, 50_000_000);
  assert.equal(manifest.gatewayContext.hostingCandidateFileCount, 77);
  assert.ok(manifest.hostingOverlay.candidatePaths.includes('public/js/crm/projects/workspace.js'));
  assert.ok(manifest.hostingOverlay.candidatePaths.includes('public/css/entrance-test-ui-annotations.css'));
  assert.ok(manifest.gatewayContext.includeTrees.includes('public/prototypes/bel-working-as-equals-demo'));
  assert.ok(manifest.gatewayContext.excludeFiles.includes('public/prototypes/bel-working-as-equals-demo/README.md'));
  assert.ok(manifest.gatewayContext.forbiddenPrefixes.includes('public/database/'));
  assert.deepEqual(manifest.hostingOverlay.liveBaselineFiles['public/css/entrance-test-ui-annotations.css'], {
    liveUrl: 'https://listening-tasks-3ae34.web.app/css/entrance-test-ui-annotations.css',
    rawBytes: 2951,
    rawSha256: '55dda6ea2afbe04d34a83256371ddf1eba3f4f9135a5bec5831a75a47341524e',
    preservationRule: 'candidate must retain these exact bytes as a prefix and append only the approved additive rule'
  });
  assert.equal(manifest.releaseControl.expiryUnit, 'epoch-seconds');
  assert.match(manifest.releaseControl.ambiguousPublication, /state HOLD/);

  const dockerfile = read('backend/presentation-demo/Dockerfile');
  assert.doesNotMatch(dockerfile, /^COPY public \/app\/public$/m);
  for (const source of ['public/presentation-demo', 'public/js/presentation-demo', 'public/prototypes/bel-working-as-equals-demo']) {
    assert.match(dockerfile, new RegExp(`^COPY ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `, 'm'));
  }
  const dockerignore = read('backend/presentation-demo/Dockerfile.dockerignore');
  assert.match(dockerignore, /^\*\*$/m);
  assert.match(dockerignore, /^!functions\/src\/\*\*$/m);
  assert.doesNotMatch(dockerignore, /^!public\/database(?:\/|$)/m);
});

test('shared CRM entry files retain live bootstrap and Projects markers while adding BEL', () => {
  const html = read('public/crm-admin.html');
  const script = read('public/crm-admin.js');
  for (const marker of [
    '20260914-v2.0.6',
    'data-view="timeline"',
    'books-word-segmenter.js?v=20260914-v2.0.6"></script>',
    'mermaid.min.js" defer',
    'data-main="presentation-demo"',
    'data-panel="presentation-demo"',
    'js/crm/presentation-demo-workspace.js?v=20260914-v2.0.6'
  ]) assert.ok(html.includes(marker), `missing CRM HTML marker: ${marker}`);
  for (const marker of [
    'function startCrmAdmin()',
    'startCrmAdmin();',
    '"presentation-demo": { label:',
    "['projects', 'presentation-demo'].includes",
    "requested === 'presentation-demo'"
  ]) assert.ok(script.includes(marker), `missing CRM script marker: ${marker}`);
});

test('API candidate preserves deployed deltas and verified Projects behavior', () => {
  const deployed = {
    'functions/src/crm/data-input/command-service.js': '5089844283aa4716b65e67f7e0ccccc1c4dc938337a98fb8213a38e2c362305d',
    'functions/src/crm/projects/task-links-service.js': '43b912145ad6422e2ebf1f4d28df55d2150d79dae215d53f4c4d1b212a789fe7',
    'functions/src/data/read-aloud-connected-speech-index.json': '594e9393f15912e7e50d0a20b3a9b548e663bd7d4856ef9b90c90d05179ee8c0'
  };
  for (const [relative, expected] of Object.entries(deployed)) assert.equal(normalizedSha256(relative), expected, relative);
  assert.deepEqual(
    fs.readFileSync(path.join(ROOT, 'public/database/RA/connected-speech-index.json')),
    fs.readFileSync(path.join(ROOT, 'functions/src/data/read-aloud-connected-speech-index.json')),
    'deployed Functions index must match its canonical public source'
  );

  const feed = read('functions/src/crm/projects/change-feed-service.js');
  for (const marker of ['operationId', 'actorUid', 'command']) assert.ok(feed.includes(marker), `change feed must preserve ${marker}`);

  const commands = read('functions/src/crm/projects/domain/command-service.js');
  assert.match(commands, /effectiveSectionId:\s*resolvedSectionId/);
  assert.match(commands, /expectedStructureRevision !== undefined/);
  assert.match(commands, /structureRevision:\s*structureBefore/);
});

test('Functions dependency lineage pins the reviewed Multer security upgrade', () => {
  const packageJson = JSON.parse(read('functions/package.json'));
  const packageLock = JSON.parse(read('functions/package-lock.json'));
  const multerLock = packageLock.packages['node_modules/multer'];
  const manifest = JSON.parse(read('scripts/bel-demo/release-remediation-manifest.json'));
  const override = manifest.apiLineage.intentionalDependencyOverrides;

  assert.equal(packageJson.dependencies.multer, '2.3.0');
  assert.equal(packageLock.packages[''].dependencies.multer, '2.3.0');
  assert.equal(multerLock.version, '2.3.0');
  assert.equal(multerLock.resolved, 'https://registry.npmjs.org/multer/-/multer-2.3.0.tgz');
  assert.equal(multerLock.integrity, 'sha512-cjNbm3sttszgZeGfJR124D+jFEfkXCVAsoPBmFn9X7UxmDSFHWqE2CoEj0vrmSpuAFnqWR1Szcm9QTsiHr60Xw==');
  assert.ok(override, 'the intentional security override must be declared');
  for (const relative of ['functions/package.json', 'functions/package-lock.json']) {
    assert.ok(override[relative], `missing dependency override for ${relative}`);
    assert.equal(override[relative].expectedNormalizedSha256, normalizedSha256(relative));
    assert.ok(override[relative].liveNormalizedSha256);
  }
  assert.equal(manifest.apiLineage.deployedNormalizedHashes['functions/package.json'], undefined);
  assert.equal(manifest.apiLineage.deployedNormalizedHashes['functions/package-lock.json'], undefined);
});

test('release verifier is present and read-only by default', () => {
  const verifier = read('scripts/bel-demo/verify-release-remediation.cjs');
  assert.match(verifier, /--evidence/);
  assert.match(verifier, /process\.env\.ComSpec/, 'Windows gcloud invocation must use the command processor');
  assert.match(verifier, /intentionalDependencyOverrides/);
  assert.match(verifier, /multerLock/);
  assert.match(verifier, /live-entrance-test-ui-annotations\.css/);
  assert.match(verifier, /candidateAnnotation\.subarray/);
  assert.doesNotMatch(verifier, /execFileSync\(gcloud,/, 'Node cannot execute gcloud.cmd directly on Windows');
  assert.doesNotMatch(verifier, /firebase\s+deploy|gcloud\s+run\s+deploy|populateFiles/);
});

test('final browser gate includes the entrance stylesheet and does not suppress its MIME failure', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'public/css/entrance-test-ui-annotations.css')));
  const browser = read('tests/browser/crm-projects/phase4-discussions-recovery-browser-check.js');
  assert.doesNotMatch(browser, /entrance-test-ui-annotations\.css[\s\S]*MIME type[\s\S]*return true/);
});

test('candidate entrance annotations retain every live toolbar and capture-layer affordance', () => {
  const css = read('public/css/entrance-test-ui-annotations.css');
  for (const marker of [
    '.et-annotation-toolbar',
    '.et-annotation-actions',
    '.et-annotation-overlay',
    '.et-annotation-capture-layer',
    '.et-annotation-dialog',
    '.et-annotation-picker',
    '.et-annotation-list',
    '@media(max-width:600px)',
    '@media(prefers-reduced-motion:reduce)',
    'pointer-events:none',
    'touch-action:none',
    'max-height:calc(100dvh - 24px)',
    'box-shadow'
  ]) assert.ok(css.includes(marker), `candidate stylesheet lost live annotation marker: ${marker}`);
  assert.ok(Buffer.byteLength(css, 'utf8') >= 2951, 'candidate stylesheet must not be a placeholder smaller than the reviewed live baseline');
});

test('Chrome browser gate treats the annotation stylesheet as a real response and checks its loaded rules', () => {
  const browser = read('tests/browser/crm-projects/phase4-discussions-recovery-browser-check.js');
  assert.match(browser, /entrance-test-ui-annotations\.css/);
  assert.match(browser, /content-type/i);
  assert.match(browser, /text\/css/);
  assert.match(browser, /et-annotation-overlay/);
  assert.match(browser, /et-annotation-capture-layer/);
  assert.doesNotMatch(browser, /MIME type[\s\S]*return true/);
  assert.match(browser, /response\.body\(\)/);
  assert.match(browser, /createHash\(['"]sha256['"]\)/);
  assert.match(browser, /exactCandidateBytesServed/);
  assert.match(browser, /phase4-annotation-css-served-evidence\.json/);
});

test('production rehearsal uses the real CRM More menu and binds live evidence to a separate post-deployment gate', () => {
  const rehearsal = read('tests/browser/bel-demo-online/production_rehearsal.py');
  assert.match(rehearsal, /crm-admin\.html"/);
  assert.match(rehearsal, /crm-nav-more-dropdown \.crm-dropdown-menu button\[data-main="presentation-demo"\]/);
  assert.match(rehearsal, /--deployed-identities-url/);
  assert.match(rehearsal, /immediate read-only deployed identity provider/);
  assert.match(rehearsal, /browserServedCandidateAssets/);
  assert.match(rehearsal, /postDeploymentVerification/);
  assert.match(rehearsal, /localDraftClearedBeforeReload/);
  assert.match(rehearsal, /progressionCoverage/);
});

test('gateway Node 22 engine contract agrees with its lockfile', () => {
  const pkg = JSON.parse(read('backend/presentation-demo/package.json'));
  const lock = JSON.parse(read('backend/presentation-demo/package-lock.json'));
  assert.deepEqual(lock.packages[''].engines, pkg.engines);
  assert.equal(JSON.parse(read('functions/package.json')).engines.node, '22');
  assert.match(read('backend/presentation-demo/Dockerfile'), /^FROM node:22-slim/m);
});
