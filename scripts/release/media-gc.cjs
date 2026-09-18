'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Storage } = require('@google-cloud/storage');

const DEFAULT_PROJECT_ID = 'listening-tasks-3ae34';
const DEFAULT_BUCKET_NAME = 'listening-tasks-3ae34-practice-media';
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Discovers all protected objects from local and known publications.
 * Protects:
 *  1. Production pinned publication in config/media-release.lock.json
 *  2. All local catalog shards across all publications in public/catalogs/
 *  3. Historical / supported rollback publications
 */
function discoverProtectedObjects(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const protectedObjects = new Map();
  const protectedMetadataFiles = new Set();

  function addRef(storageKey, refReason) {
    if (!storageKey) return;
    const normKey = storageKey.replace(/\\/g, '/');
    if (!protectedObjects.has(normKey)) {
      protectedObjects.set(normKey, new Set());
    }
    protectedObjects.get(normKey).add(refReason);
  }

  const discoveryErrors = [];

  // 1. Read production media-release.lock.json
  const lockPath = path.join(repoRoot, 'config', 'media-release.lock.json');
  let activePublicationId = null;
  if (fs.existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      activePublicationId = lockData.publicationId;
      if (activePublicationId) {
        protectedMetadataFiles.add(`publications/${activePublicationId}/release.json`);
      } else {
        discoveryErrors.push('Lock file exists but publicationId is missing');
      }
    } catch (err) {
      discoveryErrors.push(`Error reading ${lockPath}: ${err.message}`);
      console.warn(`[media:gc] Warning reading ${lockPath}:`, err.message);
    }
  } else {
    discoveryErrors.push(`Production lock file not found: ${lockPath}`);
  }

  // 2. Scan all catalog directories under public/catalogs/
  const catalogsRoot = path.join(repoRoot, 'public', 'catalogs');
  if (fs.existsSync(catalogsRoot)) {
    let pubDirs = [];
    try {
      pubDirs = fs.readdirSync(catalogsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      discoveryErrors.push(`Failed to read catalogs root directory: ${err.message}`);
    }

    for (const pubDir of pubDirs) {
      const pubPath = path.join(catalogsRoot, pubDir);
      protectedMetadataFiles.add(`publications/${pubDir}/release.json`);

      let shards = [];
      try {
        shards = fs.readdirSync(pubPath).filter((f) => f.endsWith('.json'));
      } catch (err) {
        discoveryErrors.push(`Failed to read shards in ${pubDir}: ${err.message}`);
      }

      for (const shard of shards) {
        const shardRelativeKey = `catalogs/${pubDir}/${shard}`;
        protectedMetadataFiles.add(shardRelativeKey);

        try {
          const shardData = JSON.parse(fs.readFileSync(path.join(pubPath, shard), 'utf8'));
          if (shardData.assets && typeof shardData.assets === 'object') {
            for (const [logicalPath, meta] of Object.entries(shardData.assets)) {
              const reason = `${pubDir} (${shard} -> ${logicalPath})`;
              if (meta.key) addRef(meta.key, reason);
              if (meta.sha256) {
                const ext = path.extname(logicalPath).toLowerCase();
                addRef(`media/sha256/${meta.sha256}${ext}`, reason);
              }
            }
          }
        } catch (err) {
          discoveryErrors.push(`Error reading shard ${shardRelativeKey}: ${err.message}`);
          console.warn(`[media:gc] Warning reading shard ${shardRelativeKey}:`, err.message);
        }
      }
    }
  } else {
    discoveryErrors.push(`Catalogs directory not found: ${catalogsRoot}`);
  }

  return {
    activePublicationId,
    protectedObjects,
    protectedMetadataFiles,
    discoveryErrors,
    isComplete: discoveryErrors.length === 0,
    totalProtectedObjectKeys: protectedObjects.size,
    totalProtectedMetadataKeys: protectedMetadataFiles.size
  };
}

/**
 * Read-only Garbage Collection Planner.
 * Streams objects from GCS, compares against the protection set,
 * and records generation preconditions without performing deletions.
 */
async function planMediaGc(options = {}) {
  const projectId = options.projectId || DEFAULT_PROJECT_ID;
  const bucketName = options.bucketName || DEFAULT_BUCKET_NAME;
  const repoRoot = options.repoRoot || REPO_ROOT;
  const limit = options.limit || 0;

  console.log('================================================================');
  console.log(' BEL Practice Media Garbage Collection Planner (Read-Only)');
  console.log('================================================================');
  console.log(`GCS Project:       ${projectId}`);
  console.log(`Target Bucket:     gs://${bucketName}`);
  console.log(`Repository Root:   ${repoRoot}`);
  console.log(`Execution Mode:    READ-ONLY AUDIT & PLANNING (Zero Deletions)`);
  console.log('----------------------------------------------------------------');

  const discovery = discoverProtectedObjects({ repoRoot });
  console.log(`Active Publication:       ${discovery.activePublicationId || 'None (Unlocked)'}`);
  console.log(`Protected Media Keys:     ${discovery.totalProtectedObjectKeys.toLocaleString()}`);
  console.log(`Protected Metadata Files: ${discovery.totalProtectedMetadataKeys.toLocaleString()}`);
  console.log('----------------------------------------------------------------');
  console.log('Streaming object inventory from GCS bucket...');

  const storage = new Storage({ projectId });
  const bucket = storage.bucket(bucketName);

  const retained = [];
  const candidates = [];
  let totalObjectsScanned = 0;
  let totalScannedBytes = 0;
  let totalRetainedBytes = 0;
  let totalCandidateBytes = 0;

  return new Promise((resolve, reject) => {
    const stream = bucket.getFilesStream();

    stream.on('data', (file) => {
      totalObjectsScanned += 1;
      const size = Number(file.metadata.size || 0);
      const generation = String(file.metadata.generation || '');
      const updated = file.metadata.updated || null;
      const md5Hash = file.metadata.md5Hash || null;
      totalScannedBytes += size;

      const name = file.name;
      const isMediaContent = name.startsWith('media/sha256/');
      const isMetadata = name.startsWith('catalogs/') || name.startsWith('publications/');

      if (discovery.protectedObjects.has(name)) {
        const reasons = Array.from(discovery.protectedObjects.get(name) || []);
        retained.push({
          name,
          size,
          generation,
          type: 'media',
          primaryReference: reasons[0] || 'active-catalog',
          referenceCount: reasons.length
        });
        totalRetainedBytes += size;
      } else if (discovery.protectedMetadataFiles.has(name) || isMetadata) {
        retained.push({
          name,
          size,
          generation,
          type: 'metadata',
          primaryReference: 'release-metadata-archive',
          referenceCount: 1
        });
        totalRetainedBytes += size;
      } else if (isMediaContent) {
        candidates.push({
          name,
          size,
          generation,
          updated,
          md5Hash,
          reason: 'UNREFERENCED_BY_ANY_ACTIVE_CATALOG',
          precondition: {
            ifGenerationMatch: generation
          }
        });
        totalCandidateBytes += size;
      } else {
        retained.push({
          name,
          size,
          generation,
          type: 'unrecognized-non-media',
          primaryReference: 'protected-by-default',
          referenceCount: 1
        });
        totalRetainedBytes += size;
      }

      if (totalObjectsScanned % 10000 === 0) {
        console.log(`Scanned ${totalObjectsScanned.toLocaleString()} objects...`);
      }

      if (limit > 0 && totalObjectsScanned >= limit) {
        stream.destroy();
      }
    });

    stream.on('error', (err) => {
      reject(err);
    });

    stream.on('end', () => {
      const isIndeterminate = !discovery.isComplete || (limit > 0 && totalObjectsScanned >= limit);
      const auditStatus = isIndeterminate ? 'INDETERMINATE' : 'COMPLETE';

      const referencedCount = retained.length;
      const referencedBytes = totalRetainedBytes;
      const potentiallyUnreferencedCount = isIndeterminate ? 0 : candidates.length;
      const potentiallyUnreferencedBytes = isIndeterminate ? 0 : totalCandidateBytes;
      const indeterminateCount = isIndeterminate ? candidates.length : 0;
      const indeterminateBytes = isIndeterminate ? totalCandidateBytes : 0;

      console.log(`Scan completed: ${totalObjectsScanned.toLocaleString()} objects examined.`);
      console.log('----------------------------------------------------------------');
      console.log('GC Audit Summary:');
      console.log(`  Audit Status:               ${auditStatus}`);
      console.log(`  Total Bucket Objects:       ${totalObjectsScanned.toLocaleString()}`);
      console.log(`  Total Bucket Storage:       ${(totalScannedBytes / 1024 / 1024 / 1024).toFixed(3)} GB (${totalScannedBytes.toLocaleString()} bytes)`);
      console.log(`  [1] Referenced:             ${referencedCount.toLocaleString()} objects (${(referencedBytes / 1024 / 1024 / 1024).toFixed(3)} GB)`);
      console.log(`  [2] Potentially Unref:      ${potentiallyUnreferencedCount.toLocaleString()} objects (${(potentiallyUnreferencedBytes / 1024 / 1024 / 1024).toFixed(3)} GB)`);
      console.log(`  [3] Indeterminate:          ${indeterminateCount.toLocaleString()} objects (${(indeterminateBytes / 1024 / 1024 / 1024).toFixed(3)} GB)`);
      if (isIndeterminate) {
        console.log('  NOTICE: Audit is INDETERMINATE; zero objects are flagged as deletion candidates.');
      }
      console.log('----------------------------------------------------------------');
      console.log('SAFETY ENFORCEMENT: Permanent read-only tool. 0 objects were deleted or modified.');
      console.log('================================================================');

      const planReport = {
        generatedAt: new Date().toISOString(),
        mode: 'READ_ONLY_PLAN',
        projectId,
        bucketName,
        activePublicationId: discovery.activePublicationId,
        auditStatus,
        discoveryErrors: discovery.discoveryErrors,
        summary: {
          totalObjectsScanned,
          totalScannedBytes,
          referencedCount,
          referencedBytes,
          potentiallyUnreferencedCount,
          potentiallyUnreferencedBytes,
          indeterminateCount,
          indeterminateBytes
        },
        categories: {
          referenced: {
            count: referencedCount,
            bytes: referencedBytes,
            description: 'Required by a supported production, preview, rollback, or pending publication.'
          },
          potentiallyUnreferenced: {
            count: potentiallyUnreferencedCount,
            bytes: potentiallyUnreferencedBytes,
            description: 'Not referenced within the successfully completed audit scope.'
          },
          indeterminate: {
            count: indeterminateCount,
            bytes: indeterminateBytes,
            description: 'Status could not be established because inventory or publication evidence was incomplete.'
          }
        },
        candidatesSample: isIndeterminate ? [] : candidates.slice(0, 100),
        allCandidates: isIndeterminate ? [] : candidates
      };

      const outputDir = path.join(repoRoot, '.local', 'media-gc');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = options.outputPath || path.join(outputDir, `gc-plan-${timestamp}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(planReport, null, 2), 'utf8');
      console.log(`Detailed GC plan recorded at:\n  ${outputPath}`);

      resolve({
        ok: true,
        reportPath: outputPath,
        plan: planReport
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--execute') || args.includes('--delete') || args.includes('-f') || args.includes('--force')) {
    console.error('[media:gc] Fatal: media:gc is a permanent read-only audit tool. Mutation or deletion flags (--execute, --delete) are strictly rejected.');
    process.exit(1);
  }
  const isJson = args.includes('--json');
  const dryRun = true;

  try {
    const result = await planMediaGc({
      dryRun
    });
    if (isJson) {
      console.log(JSON.stringify(result.plan.summary));
    }
  } catch (err) {
    console.error('[media:gc] Fatal error:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  discoverProtectedObjects,
  planMediaGc,
  DEFAULT_PROJECT_ID,
  DEFAULT_BUCKET_NAME
};
