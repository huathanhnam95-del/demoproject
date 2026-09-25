'use strict';

const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const HASH = /^[0-9a-f]{64}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const ID = /^[a-z][a-z0-9-]{4,62}$/;
const OPERATION = /^projects\/(?:[a-z][a-z0-9-]{4,62}|\d+)\/operations\/[A-Za-z0-9_-]+$/;
const FILE = /^\/(?!\/)[^?#\\\x00-\x1f]+$/;
const validFile = value => typeof value === 'string' && FILE.test(value) &&
  !value.includes('//') && !value.split('/').some(segment => segment === '.' || segment === '..');
const MERGED_HTML = new Set(['/index.html', '/crm-admin.html', '/crm-entrance-test-result.html']);
const REVIEWED_VERSION_TOKENS = Object.freeze({
  '/index.html': 1,
  '/crm-admin.html': 97,
  '/crm-entrance-test-result.html': 5
});

class PreservationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PreservationError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => { throw new PreservationError(code, message, details); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const configHash = config => sha(canonical(config));
const versionName = (site, value) => new RegExp(`^sites/${site}/versions/[A-Za-z0-9_-]+$`).test(value || '');
const releaseName = (site, value) => new RegExp(`^sites/${site}/(?:releases|channels/live/releases)/[A-Za-z0-9_-]+$`).test(value || '');
const canonicalRelease = (site, value) => String(value).replace(`sites/${site}/channels/live/releases/`, `sites/${site}/releases/`);

function fileMap(rows, label) {
  if (!Array.isArray(rows)) fail('PLAN_SCHEMA', `${label} must be an array.`);
  const map = new Map();
  for (const row of rows) {
    if (!row || !validFile(row.path) || !HASH.test(row.hash || '') ||
        map.has(row.path)) fail('PLAN_SCHEMA', `${label} has an invalid or duplicate path/hash.`);
    map.set(row.path, row.hash.toLowerCase());
  }
  return map;
}

function sameMap(expected, actual, label) {
  if (expected.size !== actual.size) fail('FILE_DRIFT', `${label} file count changed.`);
  for (const [name, hash] of expected) if (actual.get(name) !== hash) {
    fail('FILE_DRIFT', `${label} file changed: ${name}.`);
  }
}

function assertSnapshot(actual, expected, label) {
  if (!actual || actual.release !== expected.release || actual.version !== expected.version ||
      configHash(actual.config) !== expected.configHash) fail('LIVE_DRIFT', `${label} release, version, or config changed.`);
  sameMap(expected.files, fileMap(actual.files, `${label} files`), label);
}

function readRegular(file, label) {
  if (!path.isAbsolute(file)) fail('PLAN_SCHEMA', `${label} must be an absolute path.`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('PLAN_SCHEMA', `${label} must be a regular file.`);
  return fs.readFileSync(file);
}

function newerVersion(next, prior) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value || '') ? value.split('.').map(Number) : null;
  const a = parse(next);
  const b = parse(prior);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function outside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '..' || relative.startsWith(`..${path.sep}`);
}

function reviewedExternalBytes(ctx, file, expectedHash, label) {
  if (!HASH.test(expectedHash || '') || !outside(ctx.candidateRoot, file) ||
      (ctx.sourceRoot && !outside(ctx.sourceRoot, file))) fail('MERGE_PROOF', `${label} is not an external reviewed input.`);
  const real = fs.realpathSync.native(file);
  if (!outside(ctx.candidateRoot, real) || (ctx.sourceRoot && !outside(ctx.sourceRoot, real))) {
    fail('MERGE_PROOF', `${label} resolves inside source or candidate.`);
  }
  const bytes = readRegular(file, label);
  if (sha(bytes) !== expectedHash.toLowerCase()) fail('MERGE_PROOF', `${label} hash changed.`);
  return bytes;
}

function selectedSourceBlob(ctx, relative) {
  if (typeof ctx.readSourceBlob === 'function') return ctx.readSourceBlob(relative);
  if (!ctx.sourceRoot || !/^public\/[A-Za-z0-9._/ -]+$/.test(relative) || relative.includes('/../')) {
    fail('MERGE_PROOF', 'Selected source path is invalid.');
  }
  const result = spawnSync('git', ['--no-lazy-fetch', 'show', `${ctx.sourceSha}:${relative}`],
    { cwd: ctx.sourceRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) fail('MERGE_PROOF', `Selected source blob is missing: ${relative}.`);
  return result.stdout;
}

function syncReviewedHtml(file, bytes, version, crmVersion) {
  let content = bytes.toString('utf8');
  if (file === '/index.html') {
    const indicator = /(<div id="version-indicator" class="version-indicator">)V\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(<\/div>)/g;
    if ([...content.matchAll(indicator)].length !== REVIEWED_VERSION_TOKENS[file]) {
      fail('MERGE_PROOF', 'Reviewed index version indicator count changed.');
    }
    content = content.replace(
      indicator,
      `$1V${version}$2`
    ).replace(/(src=["']\/read-aloud-mode\.js\?v=)[^"'&\s]+(["'])/g, `$1${version}$2`);
    if ([...content.matchAll(new RegExp(`(<div id="version-indicator" class="version-indicator">)V${version.replace(/\./g, '\\.')}(</div>)`, 'g'))].length !== REVIEWED_VERSION_TOKENS[file]) {
      fail('MERGE_PROOF', 'Versioned index indicator count changed.');
    }
  } else if (file === '/crm-admin.html' || file === '/crm-entrance-test-result.html') {
    const token = /\?v=\d{8}-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/g;
    if ([...content.matchAll(token)].length !== REVIEWED_VERSION_TOKENS[file]) {
      fail('MERGE_PROOF', `Reviewed CRM version token count changed: ${file}.`);
    }
    content = content.replace(/\?v=\d{8}-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/g, `?v=${crmVersion}`);
    if ([...content.matchAll(token)].filter(match => match[0] === `?v=${crmVersion}`).length !== REVIEWED_VERSION_TOKENS[file]) {
      fail('MERGE_PROOF', `Versioned CRM token count changed: ${file}.`);
    }
  } else fail('MERGE_PROOF', 'No approved merge transformation exists for this path.');
  return Buffer.from(content, 'utf8');
}

function onlyLineEndingsChanged(candidate, overlay) {
  let a;
  let b;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    a = decoder.decode(candidate);
    b = decoder.decode(overlay);
  } catch (_) { return false; }
  if (a.includes('\r') && a.replace(/\r\n/g, '').includes('\r')) return false;
  if (b.includes('\r') && b.replace(/\r\n/g, '').includes('\r')) return false;
  return a !== b && a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

function verifyMergeProof(ctx, item, output, baseFiles) {
  if (!MERGED_HTML.has(item.path) || !item.mergeProof ||
      !/^\d{8}-v\d+\.\d+\.\d+$/.test(ctx.versionOracle?.crmVersion || '')) {
    fail('MERGE_PROOF', `No approved live merge proof exists: ${item.path}.`);
  }
  const proof = item.mergeProof;
  if (proof.liveInputHostingHash !== baseFiles.get(item.path) ||
      !HASH.test(proof.sourceRawSha256 || '') || !HASH.test(proof.versionSyncScriptSha256 || '')) {
    fail('MERGE_PROOF', `Merge source or live identity differs: ${item.path}.`);
  }
  const live = reviewedExternalBytes(ctx, proof.liveInputPath, proof.liveInputRawSha256, 'Captured live HTML');
  if (sha(zlib.gzipSync(live, { level: 9 })) !== proof.liveInputHostingHash) {
    fail('MERGE_PROOF', `Captured live bytes do not match the Hosting content hash: ${item.path}.`);
  }
  const frozen = reviewedExternalBytes(ctx, proof.frozenOverlayPath, proof.frozenOverlayRawSha256, 'Reviewed frozen merge');
  reviewedExternalBytes(ctx, proof.reviewedEvidencePath, proof.reviewedEvidenceSha256, 'Reviewed merge evidence');
  const source = selectedSourceBlob(ctx, `public${item.path}`);
  if (!Buffer.isBuffer(source) || sha(source) !== proof.sourceRawSha256.toLowerCase() || !live.length || !frozen.length) {
    fail('MERGE_PROOF', `Merge source, live input, or reviewed output changed: ${item.path}.`);
  }
  const syncScript = readRegular(path.join(ctx.candidateRoot, 'scripts', 'sync-version.js'), 'Selected version generator');
  if (sha(syncScript) !== proof.versionSyncScriptSha256.toLowerCase()) fail('MERGE_PROOF', 'Selected version generator changed.');
  const derived = syncReviewedHtml(item.path, frozen, ctx.versionOracle.version, ctx.versionOracle.crmVersion);
  if (!derived.equals(output)) fail('MERGE_PROOF', `Versioned live merge differs from reviewed transform: ${item.path}.`);
}

function buildPlanFromReviewedBundle(ctx, bundle, bundleSelection = null) {
  const keys = ['finalManifestPath', 'finalOverlayMapPath', 'versionReceiptPath', 'frozenOverlayMapPath',
    'reviewedMergeEvidencePath', 'liveSelectedRoot'];
  const pinned = [
    ['finalManifestPath', 'finalManifestSha256'], ['finalOverlayMapPath', 'finalOverlayMapSha256'],
    ['versionReceiptPath', 'versionReceiptSha256'], ['frozenOverlayMapPath', 'frozenOverlayMapSha256'],
    ['reviewedMergeEvidencePath', 'reviewedMergeEvidenceSha256']
  ];
  if (bundle.kind !== 'reviewed-finalizer-bundle' || keys.some(key => !path.isAbsolute(bundle[key] || '')) ||
      pinned.some(([, hashKey]) => !HASH.test(bundle[hashKey] || '')) ||
      !Number.isSafeInteger(bundle.expectedLiveFiles) || !Number.isSafeInteger(bundle.expectedFinalFiles) ||
      !Number.isSafeInteger(bundle.expectedOverlays) ||
      !['adc', 'gcloud'].includes(bundle.credentialMode || 'adc')) fail('BUNDLE_SCHEMA', 'Reviewed finalizer bundle is incomplete.');
  const selection = {};
  const pinnedBytes = {};
  for (const [pathKey, hashKey] of pinned) {
    const selectedPath = fs.realpathSync.native(bundle[pathKey]);
    if (!outside(ctx.candidateRoot, selectedPath) || (ctx.sourceRoot && !outside(ctx.sourceRoot, selectedPath))) {
      fail('BUNDLE_INPUT', `Reviewed bundle input resolves inside source or candidate: ${pathKey}.`);
    }
    const bytes = readRegular(bundle[pathKey], pathKey);
    if (sha(bytes) !== bundle[hashKey].toLowerCase()) fail('BUNDLE_INPUT', `Reviewed bundle input hash changed: ${pathKey}.`);
    pinnedBytes[pathKey] = bytes;
    selection[pathKey] = { path: bundle[pathKey], sha256: bundle[hashKey].toLowerCase() };
  }
  const manifestBytes = pinnedBytes.finalManifestPath;
  const overlayMapBytes = pinnedBytes.finalOverlayMapPath;
  const frozenMapBytes = pinnedBytes.frozenOverlayMapPath;
  const versionReceiptBytes = pinnedBytes.versionReceiptPath;
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const map = JSON.parse(overlayMapBytes.toString('utf8'));
  const frozen = JSON.parse(frozenMapBytes.toString('utf8'));
  const versionReceipt = JSON.parse(versionReceiptBytes.toString('utf8'));
  if (manifest.offlineVersionResolved !== true || manifest.finalSourceSha !== ctx.sourceSha ||
      manifest.version !== ctx.versionOracle?.version || manifest.versionDateToken !== ctx.versionOracle?.crmVersion ||
      manifest.configSource !== 'exact-live-version' || manifest.project !== ctx.project.id ||
      map.finalSourceSha !== ctx.sourceSha || map.sourceVersion !== manifest.sourceVersion ||
      map.version !== manifest.version || !Array.isArray(map.overlay) ||
      map.overlay.length !== bundle.expectedOverlays || !Array.isArray(manifest.files) ||
      manifest.files.length !== bundle.expectedFinalFiles || !Array.isArray(frozen.overlay)) {
    fail('BUNDLE_IDENTITY', 'Finalizer artifacts do not describe the reviewed source, version, and file inventory.');
  }
  if (versionReceipt.sourceSha !== ctx.sourceSha || versionReceipt.version !== manifest.version ||
      versionReceipt.oracle?.version !== ctx.versionOracle.version ||
      versionReceipt.oracle?.crmVersion !== ctx.versionOracle.crmVersion ||
      versionReceipt.files !== bundle.expectedFinalFiles || versionReceipt.overlays !== bundle.expectedOverlays ||
      versionReceipt.noCloudMutation !== true || versionReceipt.sourceSwMatched !== true ||
      versionReceipt.sourceLazyLoaderMatched !== true || versionReceipt.serviceWorkerOnlyCacheLineChanged !== true) {
    fail('BUNDLE_VERSION', 'Offline version receipt does not match the generated source and overlay.');
  }
  if (sha(JSON.stringify(manifest.config)) !== map.configSha256) fail('BUNDLE_CONFIG', 'Finalizer config hashes disagree.');
  const finalFiles = manifest.files.map(row => ({ path: row.path, hash: row.hash }));
  const baseFiles = manifest.files.filter(row => row.liveHash).map(row => ({ path: row.path, hash: row.liveHash }));
  if (baseFiles.length !== bundle.expectedLiveFiles || !versionName(bundle.siteId, manifest.sourceVersion) ||
      !releaseName(bundle.siteId, manifest.sourceRelease)) fail('BUNDLE_IDENTITY', 'Captured live identity or file count differs.');
  const baseMap = fileMap(baseFiles, 'bundle live files');
  const frozenByPath = new Map(frozen.overlay.map(row => [row.path, row]));
  const syncScriptSha256 = sha(readRegular(path.join(ctx.candidateRoot, 'scripts', 'sync-version.js'), 'Selected version generator'));
  const reviewedEvidenceSha256 = bundle.reviewedMergeEvidenceSha256.toLowerCase();
  const overlays = map.overlay.map(row => {
    const bytes = readRegular(row.overlayPath, 'Finalizer overlay');
    const candidate = readRegular(path.join(ctx.candidateRoot, row.sourcePath), 'Generated source candidate');
    const item = { path: row.path, sourcePath: row.sourcePath, sourceKind: row.sourceKind,
      provenance: { ...(row.sourceCommit ? { sourceCommit: row.sourceCommit } : {}),
        ...(row.versionSyncedFrom ? { versionSyncedFrom: row.versionSyncedFrom } : {}) },
      rawSha256: row.rawSha256, hostingHash: row.hostingHash, bytes: row.bytes,
      bytesPath: row.overlayPath };
    if (row.sourceKind === 'live-preserving-merge') {
      const reviewed = frozenByPath.get(row.path);
      if (!reviewed || reviewed.sourceKind !== row.sourceKind || reviewed.sourcePath !== row.sourcePath) {
        fail('BUNDLE_MERGE', `Reviewed frozen merge is missing: ${row.path}.`);
      }
      const liveInputPath = path.join(bundle.liveSelectedRoot, row.path.slice(1));
      item.mergeProof = {
        liveInputPath, liveInputRawSha256: sha(readRegular(liveInputPath, 'Captured live merge input')),
        liveInputHostingHash: baseMap.get(row.path), frozenOverlayPath: reviewed.overlayPath,
        frozenOverlayRawSha256: reviewed.rawSha256,
        reviewedEvidencePath: bundle.reviewedMergeEvidencePath, reviewedEvidenceSha256,
        sourceRawSha256: sha(selectedSourceBlob(ctx, row.sourcePath)), versionSyncScriptSha256: syncScriptSha256
      };
    } else if (!candidate.equals(bytes)) {
      if (!onlyLineEndingsChanged(candidate, bytes)) fail('BUNDLE_OVERLAY', `Unreviewed output difference: ${row.path}.`);
      item.transform = 'line-endings-only';
    }
    return item;
  });
  return { schemaVersion: 1, projectId: manifest.project, siteId: bundle.siteId, sourceSha: ctx.sourceSha,
    credentialMode: bundle.credentialMode || 'adc',
    packageVersion: manifest.version, livePackageVersion: bundle.livePackageVersion,
    candidateSurfaceSha256: sha(JSON.stringify(ctx.receipt.surface)),
    base: { release: manifest.sourceRelease, version: manifest.sourceVersion,
      config: manifest.config, configSha256: configHash(manifest.config), files: baseFiles },
    final: { configSha256: configHash(manifest.config), files: finalFiles }, overlays,
    reviewedArtifacts: { bundle: bundleSelection, selection,
      finalManifestSha256: sha(manifestBytes), finalOverlayMapSha256: sha(overlayMapBytes),
      versionReceiptSha256: sha(versionReceiptBytes), frozenOverlayMapSha256: sha(frozenMapBytes),
      reviewedEvidenceSha256 } };
}

function preparePreservation(ctx, manifestPath) {
  if (!ctx || ctx.profile !== 'hosting' || !ctx.sealed || !ctx.receipt) fail('PLAN_CONTEXT', 'A sealed Hosting candidate is required.');
  if (ctx.receipt.sourceSha !== ctx.sourceSha || ctx.receipt.profile !== 'hosting' ||
      path.resolve(ctx.receipt.candidateRoot || '') !== path.resolve(ctx.candidateRoot) ||
      !outside(ctx.candidateRoot, manifestPath) ||
      (ctx.sourceRoot && !outside(ctx.sourceRoot, manifestPath))) {
    fail('PLAN_CONTEXT', 'Preservation manifest or source receipt identity is invalid.');
  }
  const manifestReal = fs.realpathSync.native(manifestPath);
  if (!outside(ctx.candidateRoot, manifestReal) ||
      (ctx.sourceRoot && !outside(ctx.sourceRoot, manifestReal))) {
    fail('PLAN_CONTEXT', 'Preservation manifest resolves inside source or candidate.');
  }
  const suppliedBytes = readRegular(manifestPath, 'Preservation manifest');
  const supplied = JSON.parse(suppliedBytes.toString('utf8'));
  const plan = supplied.kind === 'reviewed-finalizer-bundle'
    ? buildPlanFromReviewedBundle(ctx, supplied, { path: manifestPath, sha256: sha(suppliedBytes) }) : supplied;
  const credentialMode = plan?.credentialMode || 'adc';
  if (!['adc', 'gcloud'].includes(credentialMode)) fail('PLAN_SCHEMA', 'Unsupported preserved Hosting credential choice.');
  const configuredSite = Array.isArray(ctx.config?.hosting) ? null : (ctx.config?.hosting?.site || ctx.project.id);
  if (!plan || plan.schemaVersion !== 1 || plan.projectId !== ctx.project.id ||
      !ID.test(plan.siteId || '') || plan.siteId !== configuredSite ||
      plan.sourceSha !== ctx.sourceSha || !SHA.test(plan.sourceSha || '') ||
      plan.candidateSurfaceSha256 !== sha(JSON.stringify(ctx.receipt.surface)) ||
      plan.packageVersion !== ctx.versionOracle?.version ||
      !newerVersion(plan.packageVersion, plan.livePackageVersion)) {
    fail('PLAN_IDENTITY', 'Preservation manifest does not match the sealed source candidate and project.');
  }
  const base = plan.base || {};
  const final = plan.final || {};
  if (!versionName(plan.siteId, base.version) || !releaseName(plan.siteId, base.release) ||
      !base.config || typeof base.config !== 'object' || !HASH.test(base.configSha256 || '') ||
      configHash(base.config) !== base.configSha256.toLowerCase()) fail('PLAN_SCHEMA', 'Invalid captured live version or config.');
  const baseFiles = fileMap(base.files, 'base files');
  const finalFiles = fileMap(final.files, 'final files');
  if (!baseFiles.size || !Array.isArray(plan.overlays) || !plan.overlays.length ||
      finalFiles.size < baseFiles.size || final.configSha256 !== base.configSha256) {
    fail('PLAN_SCHEMA', 'Final map/config is incomplete or contains a deletion.');
  }
  const surface = new Map(ctx.receipt.surface.map(row => [row.path, row]));
  const overlays = new Map();
  for (const item of plan.overlays) {
    if (!item || !validFile(item.path) || overlays.has(item.path) ||
        !HASH.test(item.rawSha256 || '') || !HASH.test(item.hostingHash || '') ||
        !['frozen-candidate', 'live-preserving-merge', 'live-preserving-version-sync'].includes(item.sourceKind) ||
        !item.provenance || typeof item.provenance !== 'object' ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes >= 2 * 1024 * 1024 * 1024) {
      fail('PLAN_SCHEMA', 'Overlay path, hash, or provenance is invalid.');
    }
    if (item.path.startsWith('/__/')) fail('PLAN_RESERVED', `Firebase reserved path cannot be overlaid: ${item.path}.`);
    const expectedRelative = `public${item.path}`;
    if (item.sourcePath && item.sourcePath !== expectedRelative) fail('PLAN_SCHEMA', `Overlay source path differs: ${item.path}.`);
    const candidate = surface.get(expectedRelative);
    if (!candidate || !HASH.test(candidate.sha256 || '')) fail('OVERLAY_SOURCE', `Candidate file is missing: ${item.path}.`);
    if (!outside(ctx.candidateRoot, item.bytesPath) ||
        (ctx.sourceRoot && !outside(ctx.sourceRoot, item.bytesPath))) {
      fail('PLAN_SCHEMA', `Overlay bytes must remain outside source and candidate: ${item.path}.`);
    }
    const overlayReal = fs.realpathSync.native(item.bytesPath);
    if (!outside(ctx.candidateRoot, overlayReal) ||
        (ctx.sourceRoot && !outside(ctx.sourceRoot, overlayReal))) {
      fail('PLAN_SCHEMA', `Overlay bytes resolve inside source or candidate: ${item.path}.`);
    }
    const candidateBytes = readRegular(path.join(ctx.candidateRoot, expectedRelative), 'Candidate overlay');
    const bytes = readRegular(item.bytesPath, 'Overlay bytes');
    if (sha(candidateBytes) !== candidate.sha256 || sha(bytes) !== item.rawSha256.toLowerCase() || item.bytes !== bytes.length) {
      fail('OVERLAY_BYTES', `Overlay or candidate bytes changed: ${item.path}.`);
    }
    if (item.sourceKind === 'live-preserving-merge') {
      if (item.transform) fail('PLAN_SCHEMA', 'Reviewed merge cannot also claim line ending conversion.');
      verifyMergeProof(ctx, item, bytes, baseFiles);
    } else if (item.transform === 'line-endings-only') {
      if (item.sourceKind !== 'frozen-candidate' || !onlyLineEndingsChanged(candidateBytes, bytes)) {
        fail('OVERLAY_SOURCE', `Declared line ending conversion differs from candidate: ${item.path}.`);
      }
    } else if (item.transform || candidate.sha256 !== item.rawSha256.toLowerCase() || !candidateBytes.equals(bytes)) {
      fail('OVERLAY_SOURCE', `Overlay differs from the sealed generated candidate: ${item.path}.`);
    }
    const compressed = zlib.gzipSync(bytes, { level: 9 });
    if (sha(compressed) !== item.hostingHash.toLowerCase()) fail('OVERLAY_HASH', `Compressed overlay hash changed: ${item.path}.`);
    if (item.sourceKind === 'frozen-candidate' && !SHA.test(item.provenance.sourceCommit || '')) {
      fail('PLAN_SCHEMA', `Overlay has no selected source commit: ${item.path}.`);
    }
    if (item.sourceKind === 'live-preserving-version-sync' && item.provenance.versionSyncedFrom !== ctx.sourceSha) {
      fail('PLAN_SCHEMA', `Version transform is not bound to the release source: ${item.path}.`);
    }
    if (finalFiles.get(item.path) !== item.hostingHash.toLowerCase()) fail('PLAN_MAP', `Overlay is missing from final map: ${item.path}.`);
    overlays.set(item.path, { hash: item.hostingHash.toLowerCase(), compressed });
  }
  for (const [name, hash] of baseFiles) {
    const next = finalFiles.get(name);
    if (!next) fail('PLAN_DELETION', `Live path removed: ${name}.`);
    if (next !== hash && !overlays.has(name)) fail('PLAN_MAP', `Unreviewed live path changed: ${name}.`);
  }
  for (const name of finalFiles.keys()) if (!baseFiles.has(name) && !overlays.has(name)) {
    fail('PLAN_MAP', `Unreviewed path added: ${name}.`);
  }
  for (const [name, item] of overlays) if (baseFiles.get(name) === item.hash) {
    fail('PLAN_MAP', `Unnecessary overlay duplicates live content: ${name}.`);
  }
  const receipt = {
    schemaVersion: 1, projectId: plan.projectId, siteId: plan.siteId, sourceSha: ctx.sourceSha,
    credentialMode,
    packageVersion: plan.packageVersion, livePackageVersion: plan.livePackageVersion,
    candidateSurfaceSha256: plan.candidateSurfaceSha256, sourceReceiptPath: ctx.receiptPath,
    manifestSha256: sha(suppliedBytes),
    derivedPlanSha256: sha(canonical(plan)), reviewedArtifacts: plan.reviewedArtifacts || null,
    base: { release: base.release, version: base.version, configSha256: base.configSha256,
      filesSha256: sha(canonical(Object.fromEntries([...baseFiles].sort()))) },
    final: { configSha256: final.configSha256,
      filesSha256: sha(canonical(Object.fromEntries([...finalFiles].sort()))) },
    overlays: plan.overlays.map(item => ({ path: item.path, rawSha256: item.rawSha256,
      hostingHash: item.hostingHash, sourceKind: item.sourceKind, provenance: item.provenance,
      mergeProof: item.mergeProof || null, transform: item.transform || null })),
    state: 'VERIFIED_LOCAL'
  };
  return { plan, base: { release: base.release, version: base.version, configHash: base.configSha256, files: baseFiles },
    final: { configHash: final.configSha256, files: finalFiles }, overlays, receipt };
}

async function waitForClone(operation, transport, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let current = operation;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!current || !OPERATION.test(current.name || '') || current.name !== operation.name) {
      fail('CLONE_OPERATION', 'Clone returned an invalid operation.');
    }
    if (current.done) {
      if (current.error || !current.response?.name) fail('CLONE_OPERATION', 'Clone operation failed or has no version.');
      return current.response;
    }
    await sleep(1000);
    current = await transport.getOperation(current.name);
  }
  fail('CLONE_TIMEOUT', 'Clone operation did not finish; retain it for investigation.');
}

async function publishPreservation(prepared, transport, { record = () => {}, sleep, checkSource = () => {} } = {}) {
  if (!transport || typeof transport.getLive !== 'function') fail('TRANSPORT', 'A Hosting transport is required.');
  const { plan, base, final, overlays } = prepared;
  const site = plan.siteId;
  checkSource();
  assertSnapshot(await transport.getLive(site), base, 'Current live');
  const operation = await transport.clone(site, base.version);
  if (!OPERATION.test(operation?.name || '')) fail('CLONE_OPERATION', 'Clone returned no durable operation ID.');
  record({ state: 'CLONE_REQUESTED', operation: operation.name, sourceVersion: base.version });
  const clone = await waitForClone(operation, transport, sleep);
  if (!versionName(site, clone.name) || (clone.status && clone.status !== 'CREATED')) {
    fail('CLONE_VERSION', 'Clone is not a CREATED version on the selected site.');
  }
  record({ state: 'CLONED', version: clone.name, operation: operation.name });
  const cloned = await transport.getVersionWithFiles(clone.name);
  if (cloned.version !== clone.name || cloned.status !== 'CREATED' ||
      configHash(cloned.config) !== base.configHash) fail('CLONE_DRIFT', 'Clone status or config changed.');
  sameMap(base.files, fileMap(cloned.files, 'cloned files'), 'Cloned');
  const changes = Object.fromEntries([...overlays].map(([name, item]) => [name, item.hash]));
  const populated = await transport.populate(clone.name, changes);
  if (!populated || (populated.uploadRequiredHashes !== undefined &&
      !Array.isArray(populated.uploadRequiredHashes))) fail('POPULATE', 'Populate returned an invalid upload inventory.');
  const byHash = new Map([...overlays].map(([, item]) => [item.hash, item.compressed]));
  const requiredHashes = populated.uploadRequiredHashes || [];
  const unique = new Set(requiredHashes);
  if (unique.size !== requiredHashes.length || [...unique].some(hash => !byHash.has(hash))) {
    fail('UPLOAD_HASH', 'Populate requested an unknown or duplicate content hash.');
  }
  record({ state: 'POPULATED', version: clone.name, requiredHashes: [...unique] });
  for (const hash of unique) await transport.upload(populated.uploadUrl, clone.name, hash, byHash.get(hash));
  record({ state: 'UPLOADED', version: clone.name });
  const staged = await transport.getVersionWithFiles(clone.name);
  if (staged.version !== clone.name || staged.status !== 'CREATED' || configHash(staged.config) !== final.configHash) {
    fail('STAGE_DRIFT', 'Staged version status or config changed.');
  }
  const stagedFiles = fileMap(staged.files, 'staged files');
  sameMap(final.files, stagedFiles, 'Staged');
  if (staged.files.some(file => file.status !== 'ACTIVE')) fail('STAGE_PENDING', 'Staged version has files pending upload.');
  checkSource();
  assertSnapshot(await transport.getLive(site), base, 'Live before finalize');
  const finalized = await transport.finalize(clone.name);
  if (finalized.name !== clone.name || finalized.status !== 'FINALIZED' || configHash(finalized.config) !== final.configHash) {
    fail('FINALIZE_DRIFT', 'Finalized version differs from the staged version.');
  }
  record({ state: 'FINALIZED', version: clone.name });
  checkSource();
  assertSnapshot(await transport.getLive(site), base, 'Live before release');
  const release = await transport.release(site, clone.name);
  if (!releaseName(site, release.name) || release.version?.name !== clone.name) fail('RELEASE_RESPONSE', 'Release response has an unexpected identity.');
  record({ state: 'RELEASED', version: clone.name, release: release.name });
  const live = await transport.getLive(site);
  if (live.release !== release.name || live.version !== clone.name || configHash(live.config) !== final.configHash) {
    fail('LIVE_CHECK', 'The intended Hosting version is not live with the expected config.');
  }
  sameMap(final.files, fileMap(live.files, 'new live files'), 'New live');
  record({ state: 'LIVE_VERIFIED', version: clone.name, release: release.name });
  return { version: clone.name, release: release.name, verified: true };
}

function validateUploadUrl(value, site, version) {
  const url = new URL(value);
  const expected = `/upload/sites/${site}/versions/${version.split('/').at(-1)}/files`;
  if (url.protocol !== 'https:' || url.hostname !== 'upload-firebasehosting.googleapis.com' ||
      url.port || url.username || url.password || url.search || url.hash || url.pathname !== expected) {
    fail('UPLOAD_URL', 'Firebase returned an unexpected upload URL.');
  }
  return url;
}

function gcloudAccessToken({ execFile = execFileSync, platform = process.platform,
  gcloudPythonScript, pythonCommand = process.env.CLOUDSDK_PYTHON || 'python' } = {}) {
  const options = { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000,
    maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] };
  let command = 'gcloud';
  let args = ['auth', 'print-access-token'];
  if (platform === 'win32') {
    let script = gcloudPythonScript;
    if (!script) {
      let found;
      try { found = execFile('where.exe', ['gcloud.cmd'], options); }
      catch (_) { fail('GCLOUD_AUTH_UNAVAILABLE', 'The explicit gcloud credential command is unavailable.'); }
      const commandPath = String(found).split(/\r?\n/).find(Boolean);
      if (!commandPath || !path.isAbsolute(commandPath)) {
        fail('GCLOUD_AUTH_UNAVAILABLE', 'The explicit gcloud credential command was not found.');
      }
      script = path.resolve(path.dirname(commandPath), '..', 'lib', 'gcloud.py');
    }
    if (!path.isAbsolute(script) || !fs.existsSync(script) || !fs.lstatSync(script).isFile()) {
      fail('GCLOUD_AUTH_UNAVAILABLE', 'The Google Cloud SDK Python entrypoint is unavailable.');
    }
    command = pythonCommand;
    args = [script, ...args];
  }
  let token;
  try { token = String(execFile(command, args, options)).trim(); }
  catch (_) { fail('GCLOUD_AUTH_UNAVAILABLE', 'The explicit gcloud credential command failed.'); }
  if (!token || /\s/.test(token)) fail('GCLOUD_AUTH_UNAVAILABLE', 'The explicit gcloud credential command returned no usable token.');
  return token;
}

function createRestTransport({ projectId, siteId, firebaseCli, fetchImpl = global.fetch,
  credentialMode = 'adc', getAccessToken, getGcloudAccessToken }) {
  if (!ID.test(projectId || '') || !ID.test(siteId || '') ||
      !['adc', 'gcloud'].includes(credentialMode) || typeof fetchImpl !== 'function' ||
      (credentialMode === 'adc' && !getAccessToken && !firebaseCli?.packagePath) ||
      (credentialMode === 'gcloud' && getAccessToken)) {
    fail('TRANSPORT', 'Pinned Firebase CLI, project/site identity, and fetch are required.');
  }
  if (credentialMode === 'gcloud') {
    getAccessToken = getGcloudAccessToken || (() => gcloudAccessToken());
  } else if (!getAccessToken) {
    let GoogleAuth;
    try {
      const authPath = require.resolve('google-auth-library', { paths: [path.dirname(firebaseCli.packagePath)] });
      ({ GoogleAuth } = require(authPath));
    } catch (_) { fail('ADC_UNAVAILABLE', 'Google Auth Library is unavailable from the pinned Firebase CLI installation.'); }
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.hosting'] });
    getAccessToken = () => auth.getAccessToken();
  }
  const endpoint = 'https://firebasehosting.googleapis.com/v1beta1/';
  async function request(method, resource, body) {
    if (!/^(?:sites|projects)\/[A-Za-z0-9_/-]+(?::[A-Za-z]+)?(?:\?[A-Za-z0-9_=&%-]+)?$/.test(resource)) {
      fail('API_PATH', 'Invalid Hosting API path.');
    }
    const token = await getAccessToken();
    if (!token) fail('ADC_UNAVAILABLE', 'Application credentials produced no access token.');
    const response = await fetchImpl(endpoint + resource, {
      method, redirect: 'error', headers: { Authorization: `Bearer ${token}`,
        'x-goog-user-project': projectId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) fail('HOSTING_API', `Hosting API ${method} failed with status ${response.status}.`);
    return response.json();
  }
  async function allFiles(version) {
    const files = [];
    const seen = new Set();
    for (const status of ['ACTIVE', 'EXPECTED']) {
      let pageToken = '';
      for (let page = 0; page < 100; page += 1) {
        const suffix = `?status=${status}&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const result = await request('GET', `${version}/files${suffix}`);
        if (result.files !== undefined && !Array.isArray(result.files)) fail('FILE_LIST', 'Version file list is invalid.');
        for (const file of result.files || []) {
          if (file.status !== status || seen.has(file.path)) fail('FILE_LIST', 'Version file status or path is inconsistent.');
          seen.add(file.path);
          files.push(file);
        }
        if (!result.nextPageToken) break;
        if (page === 99) fail('FILE_LIST', 'Version file listing exceeded 100 pages.');
        pageToken = result.nextPageToken;
      }
    }
    return files;
  }
  return {
    async getLive(site) {
      if (site !== siteId) fail('SITE', 'Unexpected Hosting site.');
      let pageToken = '';
      let newest = null;
      for (let page = 0; page < 100; page += 1) {
        const suffix = `?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const result = await request('GET', `sites/${site}/channels/live/releases${suffix}`);
        if (!Array.isArray(result.releases)) fail('RELEASE_LIST', 'Hosting release list is invalid.');
        for (const release of result.releases) if (releaseName(site, release.name)) {
          const timestamp = Date.parse(release.releaseTime);
          if (!Number.isFinite(timestamp)) fail('RELEASE_LIST', 'Hosting release has no valid time.');
          if (!newest || timestamp > Date.parse(newest.releaseTime)) newest = release;
          else if (timestamp === Date.parse(newest.releaseTime) && release.name !== newest.name) {
            fail('RELEASE_LIST', 'Hosting live release order is ambiguous.');
          }
        }
        if (!result.nextPageToken) break;
        if (page === 99) fail('RELEASE_LIST', 'Hosting release listing exceeded 100 pages.');
        pageToken = result.nextPageToken;
      }
      if (!newest || !versionName(site, newest.version?.name)) fail('LIVE_RELEASE', 'No unambiguous live site release found.');
      const version = await request('GET', newest.version.name);
      return { release: canonicalRelease(site, newest.name), version: version.name,
        config: version.config, files: await allFiles(version.name) };
    },
    clone(site, sourceVersion) {
      if (site !== siteId || !versionName(site, sourceVersion)) fail('SITE', 'Unexpected clone source.');
      return request('POST', `sites/${site}/versions:clone`, { sourceVersion, finalize: false });
    },
    getOperation(name) {
      if (!OPERATION.test(name || '')) fail('CLONE_OPERATION', 'Unexpected operation name.');
      return request('GET', name);
    },
    async getVersionWithFiles(name) {
      if (!versionName(siteId, name)) fail('SITE', 'Unexpected version name.');
      const version = await request('GET', name);
      return { version: version.name, status: version.status, config: version.config, files: await allFiles(name) };
    },
    populate(name, files) {
      if (!versionName(siteId, name)) fail('SITE', 'Unexpected version name.');
      return request('POST', `${name}:populateFiles`, { files });
    },
    async upload(uploadUrl, name, hash, compressed) {
      if (!versionName(siteId, name) || !HASH.test(hash || '') || sha(compressed) !== hash) fail('UPLOAD_HASH', 'Upload content hash changed.');
      const url = validateUploadUrl(uploadUrl, siteId, name);
      const token = await getAccessToken();
      if (!token) fail('ADC_UNAVAILABLE', 'Application credentials produced no access token.');
      const response = await fetchImpl(`${url.href}/${hash}`, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId,
          'Content-Type': 'application/octet-stream' }, body: compressed });
      if (!response.ok) fail('UPLOAD_FAILED', `Hosting upload failed with status ${response.status}.`);
    },
    finalize(name) {
      if (!versionName(siteId, name)) fail('SITE', 'Unexpected version name.');
      return request('PATCH', `${name}?updateMask=status`, { status: 'FINALIZED' });
    },
    release(site, name) {
      if (site !== siteId || !versionName(site, name)) fail('SITE', 'Unexpected release destination.');
      return request('POST', `sites/${site}/releases?versionName=${encodeURIComponent(name)}`, {});
    }
  };
}

module.exports = { PreservationError, sha, canonical, configHash, fileMap, preparePreservation,
  publishPreservation, validateUploadUrl, createRestTransport, gcloudAccessToken,
  syncReviewedHtml, onlyLineEndingsChanged,
  buildPlanFromReviewedBundle };
