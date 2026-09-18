'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const {
  PILOT_ASSETS,
  DEFAULT_PROJECT_ID,
  DEFAULT_BUCKET_NAME,
  DEFAULT_DELIVERY_BASE_URL,
  inspectPilotAssets,
  buildPilotCatalogs,
  generatePilotPublicationId,
  verifyRemoteObject
} = require('./pilot-media-campaign.cjs');

function invokeGCloud(args) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'gcloud';
  const fullArgs = isWin ? ['/c', 'gcloud', ...args] : args;

  const res = spawnSync(cmd, fullArgs, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });

  return {
    exitCode: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim()
  };
}

async function executePilotCampaign(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || 'C:/Cursor AI');
  const targetBucket = options.targetBucket || DEFAULT_BUCKET_NAME;
  const targetProject = options.targetProject || DEFAULT_PROJECT_ID;
  const publicationId = options.publicationId || generatePilotPublicationId();
  const deliveryBaseUrl = options.deliveryBaseUrl || `https://storage.googleapis.com/${targetBucket}/`;

  console.log('================================================================');
  console.log(' BEL Practice Media: Pilot Campaign Execution');
  console.log('================================================================');
  console.log(`Publication ID:  ${publicationId}`);
  console.log(`Target Bucket:   gs://${targetBucket}`);
  console.log(`Target Project:  ${targetProject}`);
  console.log(`Delivery URL:    ${deliveryBaseUrl}`);
  console.log('----------------------------------------------------------------');

  // 1. Verify bucket exists
  const bktCheck = invokeGCloud(['storage', 'buckets', 'describe', `gs://${targetBucket}`, `--project=${targetProject}`, '--format=json']);
  if (bktCheck.exitCode !== 0) {
    throw new Error(`Target bucket gs://${targetBucket} does not exist or is inaccessible: ${bktCheck.stderr}`);
  }

  // 2. Inspect 26 pilot assets
  console.log('[1/4] Inspecting 26 pilot assets from local disk...');
  const pilotData = inspectPilotAssets(projectRoot);
  console.log(`      Total Logical Assets:   ${pilotData.totalAssets}`);
  console.log(`      Unique Storage Objects: ${pilotData.uniqueObjectsCount}`);
  console.log(`      Total Bytes:            ${(pilotData.totalBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`      Unique Bytes:           ${(pilotData.uniqueBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`      Deduplication Savings:  ${(pilotData.deduplicationSavingsBytes / 1024).toFixed(1)} KB`);

  // 3. Upload 24 unique objects
  console.log('[2/4] Uploading unique content-addressed objects with create-only precondition...');
  let uploadedCount = 0;
  let reusedCount = 0;
  const objectUploadReceipts = [];

  for (const obj of pilotData.uniqueObjects.values()) {
    const destination = `gs://${targetBucket}/${obj.storageKey}`;
    process.stdout.write(`      Uploading ${obj.storageKey}... `);

    // Use gcloud storage cp with --if-generation-match=0
    const cpRes = invokeGCloud([
      'storage', 'cp',
      obj.absolutePath,
      destination,
      '--if-generation-match=0',
      `--cache-control=public, max-age=31536000, immutable`,
      `--content-type=${obj.contentType}`,
      `--custom-metadata=sha256=${obj.sha256}`
    ]);

    if (cpRes.exitCode === 0) {
      uploadedCount++;
      process.stdout.write('[UPLOADED]\n');
      objectUploadReceipts.push({
        storageKey: obj.storageKey,
        action: 'uploaded',
        sha256: obj.sha256,
        size: obj.size
      });
    } else {
      // Check if failed due to precondition (already exists)
      const combinedOutput = `${cpRes.stdout} ${cpRes.stderr}`;
      if (combinedOutput.includes('PreconditionFailed') || combinedOutput.includes('412') || combinedOutput.includes('already exists')) {
        // Verify remote object metadata
        const descRes = invokeGCloud(['storage', 'objects', 'describe', destination, '--format=json']);
        if (descRes.exitCode === 0) {
          const descObj = JSON.parse(descRes.stdout);
          if (Number(descObj.size) === obj.size) {
            reusedCount++;
            process.stdout.write('[REUSED - BYTES MATCH]\n');
            objectUploadReceipts.push({
              storageKey: obj.storageKey,
              action: 'reused',
              sha256: obj.sha256,
              size: obj.size,
              generation: descObj.generation
            });
            continue;
          }
        }
        throw new Error(`Precondition conflict on ${obj.storageKey} but remote object did not match local size!`);
      } else {
        process.stdout.write('[FAILED]\n');
        throw new Error(`Failed to upload ${obj.storageKey}: ${cpRes.stderr}`);
      }
    }
  }

  // 4. Build pilot catalogs and root release
  console.log('[3/4] Generating pilot catalog shards and release manifest...');
  const catalogs = buildPilotCatalogs(pilotData, publicationId, deliveryBaseUrl);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-pilot-'));

  try {
    // Write shards and upload
    for (const [shardKey, payload] of Object.entries(catalogs.shardPayloads)) {
      const tempShardFile = path.join(tempDir, path.basename(shardKey));
      fs.writeFileSync(tempShardFile, payload, 'utf8');
      const shardDest = `gs://${targetBucket}/${shardKey}`;

      const shardCp = invokeGCloud([
        'storage', 'cp',
        tempShardFile,
        shardDest,
        '--content-type=application/json',
        '--cache-control=public, max-age=31536000, immutable'
      ]);

      if (shardCp.exitCode !== 0) {
        throw new Error(`Failed to upload shard ${shardKey}: ${shardCp.stderr}`);
      }
    }

    // Write root release and upload
    const tempRootFile = path.join(tempDir, 'release.json');
    fs.writeFileSync(tempRootFile, catalogs.rootReleasePayload, 'utf8');
    const rootDest = `gs://${targetBucket}/${catalogs.rootReleaseKey}`;

    const rootCp = invokeGCloud([
      'storage', 'cp',
      tempRootFile,
      rootDest,
      '--content-type=application/json',
      '--cache-control=public, max-age=31536000, immutable'
    ]);

    if (rootCp.exitCode !== 0) {
      throw new Error(`Failed to upload root release ${catalogs.rootReleaseKey}: ${rootCp.stderr}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 5. Save local checkpoint / receipt
  console.log('[4/4] Writing local pilot checkpoint evidence...');
  const checkpointDir = path.join(projectRoot, '.media-checkpoints', publicationId);
  fs.mkdirSync(checkpointDir, { recursive: true });

  const summary = {
    publicationId,
    type: 'pilot',
    ineligibleForProduction: true,
    selectionRestricted: true,
    targetBucket,
    deliveryBaseUrl,
    executedAt: new Date().toISOString(),
    stats: {
      totalLogicalAssets: pilotData.totalAssets,
      uniqueStorageObjects: pilotData.uniqueObjectsCount,
      uploadedCount,
      reusedCount,
      totalLogicalBytes: pilotData.totalBytes,
      uniqueStorageBytes: pilotData.uniqueBytes,
      deduplicationSavingsBytes: pilotData.deduplicationSavingsBytes
    },
    rootReleaseKey: catalogs.rootReleaseKey,
    objectUploadReceipts
  };

  const summaryPath = path.join(checkpointDir, 'pilot-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(`      Saved receipt to: ${summaryPath}`);
  console.log('----------------------------------------------------------------');
  console.log(`Pilot campaign upload complete: ${uploadedCount} uploaded, ${reusedCount} reused.`);
  console.log('================================================================');

  return summary;
}

if (require.main === module) {
  executePilotCampaign()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error during pilot campaign execution:', err);
      process.exit(1);
    });
}

module.exports = { executePilotCampaign };
