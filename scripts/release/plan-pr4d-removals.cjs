#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOGS_DIR = path.join(REPO_ROOT, 'public', 'catalogs', 'pub-20260918-all-media');
const POLICY_PATH = path.join(REPO_ROOT, 'scripts', 'release', 'release-input-policy.json');
const BACKUP_DIR = path.join(REPO_ROOT, '.local', 'media-backup', 'pub-20260918-all-media');
const NUL_PATH = path.join(REPO_ROOT, 'approved-media-removals.nul');
const TXT_PATH = path.join(REPO_ROOT, 'approved-media-removals.txt');
const REPORT_PATH = path.join(REPO_ROOT, 'pr4d-protection-report.json');

const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.png', '.jpg', '.jpeg', '.webp', '.ogg', '.m4a']);
const PROTECTED_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.json', '.docx', '.pdf', '.js', '.cjs', '.py', '.sh', '.html', '.css', '.txt', '.csv', '.md']);

function hashFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function getTrackedFiles() {
  const output = execSync('git ls-files -z public/database', {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024
  });
  const files = [];
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] === 0) {
      if (i > start) {
        files.push(output.toString('utf8', start, i).replace(/\\/g, '/'));
      }
      start = i + 1;
    }
  }
  return files;
}

function getPublishedAssets() {
  if (!fs.existsSync(CATALOGS_DIR)) {
    throw new Error(`Catalogs dir missing: ${CATALOGS_DIR}`);
  }
  const shardFiles = fs.readdirSync(CATALOGS_DIR).filter(f => f.endsWith('.json'));
  const published = new Map(); // normalizedPath -> assetMeta
  for (const shard of shardFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(CATALOGS_DIR, shard), 'utf8'));
    if (data.assets) {
      for (const [key, meta] of Object.entries(data.assets)) {
        const norm = key.replace(/\\/g, '/');
        published.set(norm, { ...meta, shard });
      }
    }
  }
  return published;
}

function getPolicyRootsAndProtected() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const roots = (policy.cohorts && policy.cohorts['cohort-all-media'] && policy.cohorts['cohort-all-media'].roots) || [];
  const protectedInputs = new Set((policy.protectedInputs || []).map(p => p.replace(/\\/g, '/')));
  return { roots, protectedInputs };
}

function planRemovals() {
  console.log('--- Step 1: Scanning Tracked Files & Published Catalogs ---');
  const trackedFiles = getTrackedFiles();
  const publishedAssets = getPublishedAssets();
  const { roots, protectedInputs } = getPolicyRootsAndProtected();

  console.log(`Total git-tracked files in public/database: ${trackedFiles.length}`);
  console.log(`Total published GCS assets in catalog shards: ${publishedAssets.size}`);
  console.log(`Total policy externalized roots: ${roots.length}`);
  console.log(`Explicitly protected policy inputs: ${protectedInputs.size}`);

  const eligibleRemovals = [];
  const protectedFiles = [];
  const unmappedFiles = [];
  const nonMediaTracked = [];
  let totalRemovalBytes = 0;

  const modeBreakdown = {};
  const extBreakdown = {};

  for (const file of trackedFiles) {
    const ext = path.extname(file).toLowerCase();
    const isProtectedExt = PROTECTED_EXTENSIONS.has(ext);
    const isExplicitlyProtected = protectedInputs.has(file);
    const filename = path.basename(file).toLowerCase();

    // Check if protected builder/metadata file
    if (isProtectedExt || isExplicitlyProtected || filename === 'manifest.json' || filename === 'index.json' || filename.includes('question')) {
      protectedFiles.push({
        path: file,
        reason: isExplicitlyProtected ? 'EXPLICIT_POLICY_PROTECTED' : isProtectedExt ? 'BUILDER_EXTENSION_PROTECTED' : 'METADATA_NAME_PROTECTED'
      });
      continue;
    }

    // Check if media extension
    if (!MEDIA_EXTENSIONS.has(ext)) {
      nonMediaTracked.push({ path: file, ext });
      continue;
    }

    // Check externalized root coverage
    const inExternalRoot = roots.some(r => file === r || file.startsWith(r + '/'));
    if (!inExternalRoot) {
      protectedFiles.push({ path: file, reason: 'NOT_IN_EXTERNAL_ROOT' });
      continue;
    }

    // Check publication in GCS catalog
    const catalogEntry = publishedAssets.get(file);
    if (!catalogEntry) {
      unmappedFiles.push(file);
      continue;
    }

    // File is 100% eligible: Tracked ∩ Published ∩ Externalized ∩ Non-Protected Media
    const fullPath = path.join(REPO_ROOT, file);
    let statSize = 0;
    if (fs.existsSync(fullPath)) {
      statSize = fs.statSync(fullPath).size;
    } else {
      statSize = catalogEntry.size || 0;
    }

    eligibleRemovals.push({
      path: file,
      size: statSize,
      sha256: catalogEntry.sha256,
      gcsKey: catalogEntry.key,
      shard: catalogEntry.shard
    });

    totalRemovalBytes += statSize;
    extBreakdown[ext] = (extBreakdown[ext] || 0) + 1;
    const modeName = catalogEntry.shard.replace('.json', '');
    modeBreakdown[modeName] = (modeBreakdown[modeName] || 0) + 1;
  }

  console.log('\n--- Step 2: Intersection Analysis Results ---');
  console.log(`Eligible media removals: ${eligibleRemovals.length} files`);
  console.log(`Total removal bytes:     ${totalRemovalBytes.toLocaleString()} bytes (~${(totalRemovalBytes / (1024 * 1024 * 1024)).toFixed(3)} GB)`);
  console.log(`Protected builder files: ${protectedFiles.length} files`);
  console.log(`Non-media tracked files: ${nonMediaTracked.length} files`);
  console.log(`Unmapped media files:    ${unmappedFiles.length} files`);

  // Write NUL-delimited file
  const nulBuffers = eligibleRemovals.map(item => Buffer.from(item.path + '\0', 'utf8'));
  fs.writeFileSync(NUL_PATH, Buffer.concat(nulBuffers));

  // Write newline-delimited text file
  fs.writeFileSync(TXT_PATH, eligibleRemovals.map(item => item.path).join('\n') + '\n', 'utf8');

  // Write protection and summary report
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalTrackedScanned: trackedFiles.length,
      eligibleMediaRemovals: eligibleRemovals.length,
      totalRemovalBytes,
      totalRemovalGB: Number((totalRemovalBytes / (1024 * 1024 * 1024)).toFixed(3)),
      protectedFilesCount: protectedFiles.length,
      nonMediaTrackedCount: nonMediaTracked.length,
      unmappedFilesCount: unmappedFiles.length
    },
    modeBreakdown,
    extBreakdown,
    protectedSamples: protectedFiles.slice(0, 50),
    unmappedFiles
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\nWritten path files:`);
  console.log(`- NUL-delimited: ${NUL_PATH}`);
  console.log(`- Text-delimited: ${TXT_PATH}`);
  console.log(`- Audit Report: ${REPORT_PATH}`);

  return { eligibleRemovals, protectedFiles, unmappedFiles, totalRemovalBytes, report };
}

function createAndVerifyBackup(eligibleRemovals) {
  console.log('\n--- Step 3: Creating & Verifying Recovery Backup ---');
  console.log(`Target backup dir: ${BACKUP_DIR}`);

  // 1. Check disk space on C:
  try {
    const dfOut = execSync('powershell -Command "(Get-PSDrive C).Free / 1GB"', { cwd: REPO_ROOT }).toString().trim();
    const freeGb = parseFloat(dfOut);
    console.log(`Available disk space on C: ${freeGb.toFixed(2)} GB`);
    if (freeGb < 8.0) {
      throw new Error(`Insufficient disk space on C: (${freeGb.toFixed(2)} GB free, required >= 8.0 GB)`);
    }
  } catch (err) {
    console.warn('Could not verify disk space via powershell, proceeding with caution:', err.message);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const manifestFiles = [];
  let copiedBytes = 0;
  let copiedCount = 0;

  console.log(`Backing up ${eligibleRemovals.length} files...`);
  const startTime = Date.now();

  for (let i = 0; i < eligibleRemovals.length; i++) {
    const item = eligibleRemovals[i];
    const srcPath = path.join(REPO_ROOT, item.path);
    const destPath = path.join(BACKUP_DIR, item.path);

    if (!fs.existsSync(srcPath)) {
      throw new Error(`Source file missing on disk during backup: ${srcPath}`);
    }

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(srcPath, destPath);

    // Verify copy byte size
    const stat = fs.statSync(destPath);
    if (stat.size !== item.size) {
      throw new Error(`Size mismatch for ${item.path}: source ${item.size} vs backup ${stat.size}`);
    }

    copiedBytes += stat.size;
    copiedCount++;

    manifestFiles.push({
      path: item.path,
      size: stat.size,
      expectedSha256: item.sha256
    });

    if (copiedCount % 5000 === 0 || copiedCount === eligibleRemovals.length) {
      console.log(`Copied and verified ${copiedCount}/${eligibleRemovals.length} files (${(copiedBytes / 1024 / 1024).toFixed(1)} MB)...`);
    }
  }

  // Write backup manifest
  const backupManifest = {
    createdAt: new Date().toISOString(),
    backupRoot: BACKUP_DIR,
    totalFiles: copiedCount,
    totalBytes: copiedBytes,
    wallTimeMs: Date.now() - startTime,
    files: manifestFiles
  };
  const manifestPath = path.join(BACKUP_DIR, 'backup-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(backupManifest, null, 2), 'utf8');
  console.log(`Backup manifest written to: ${manifestPath}`);

  // Test restoration of sample files into temporary dir
  console.log('\n--- Step 4: Testing Sample Restoration ---');
  const tempRestoreDir = path.join(REPO_ROOT, 'scratch', 'test-restore-check');
  if (fs.existsSync(tempRestoreDir)) {
    fs.rmSync(tempRestoreDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempRestoreDir, { recursive: true });

  const sampleIndices = [
    0,
    Math.floor(eligibleRemovals.length * 0.1),
    Math.floor(eligibleRemovals.length * 0.25),
    Math.floor(eligibleRemovals.length * 0.5),
    Math.floor(eligibleRemovals.length * 0.75),
    Math.floor(eligibleRemovals.length * 0.9),
    eligibleRemovals.length - 1
  ].filter((idx, pos, arr) => arr.indexOf(idx) === pos && idx < eligibleRemovals.length);

  for (const idx of sampleIndices) {
    const sample = eligibleRemovals[idx];
    const backupSamplePath = path.join(BACKUP_DIR, sample.path);
    const restoredSamplePath = path.join(tempRestoreDir, path.basename(sample.path));
    fs.copyFileSync(backupSamplePath, restoredSamplePath);

    const restoredSha = hashFileSha256(restoredSamplePath);
    if (restoredSha !== sample.sha256) {
      throw new Error(`Restoration hash mismatch for ${sample.path}! Expected ${sample.sha256}, got ${restoredSha}`);
    }
    console.log(`✔ Restored & verified sample [${sample.path}]: SHA-256 matches expected.`);
  }

  fs.rmSync(tempRestoreDir, { recursive: true, force: true });
  console.log(`✔ Sample restoration verified 100% byte-for-byte!`);

  return { backupManifest, manifestPath };
}

function runGitRmDryRun() {
  console.log('\n--- Step 5: Executing Git RM Dry-Run ---');
  if (!fs.existsSync(NUL_PATH)) {
    throw new Error(`Pathspec file missing: ${NUL_PATH}`);
  }

  const result = spawnSync('git', [
    '--literal-pathspecs',
    'rm',
    '--dry-run',
    '--pathspec-from-file=' + NUL_PATH,
    '--pathspec-file-nul'
  ], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024
  });

  if (result.status !== 0) {
    console.error('git rm --dry-run failed:');
    console.error(result.stderr.toString());
    process.exit(1);
  }

  const dryRunLines = result.stdout.toString('utf8').trim().split('\n').filter(Boolean);
  console.log(`✔ git rm --dry-run completed successfully!`);
  console.log(`Total files staged for dry-run removal: ${dryRunLines.length}`);

  return dryRunLines;
}

function main() {
  const args = process.argv.slice(2);
  const doBackup = args.includes('--backup');
  const doDryRun = args.includes('--dry-run');

  const { eligibleRemovals, protectedFiles, unmappedFiles, totalRemovalBytes, report } = planRemovals();

  if (doBackup) {
    createAndVerifyBackup(eligibleRemovals);
  }

  if (doDryRun) {
    runGitRmDryRun();
  }

  console.log('\n======================================================');
  console.log('PR 4d Tracked Media Pruning Planning Complete!');
  console.log(`Eligible for removal:  ${eligibleRemovals.length} files (~${(totalRemovalBytes / 1024 / 1024 / 1024).toFixed(3)} GB)`);
  console.log(`Protected inputs:      ${protectedFiles.length} files`);
  console.log(`Backup completed:      ${doBackup ? 'YES' : 'NO (pass --backup)'}`);
  console.log(`Dry-run executed:      ${doDryRun ? 'YES' : 'NO (pass --dry-run)'}`);
  console.log('======================================================\n');
}

main();
