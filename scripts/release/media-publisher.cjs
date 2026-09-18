'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PROJECT_ID = 'listening-tasks-3ae34';
const DEFAULT_BUCKET_NAME = 'listening-tasks-3ae34-practice-media';
const DEFAULT_DELIVERY_BASE_URL = `https://storage.googleapis.com/${DEFAULT_BUCKET_NAME}/`;
const DEFAULT_PUBLISHER_SA = `bel-media-publisher@${DEFAULT_PROJECT_ID}.iam.gserviceaccount.com`;

const MEDIA_EXTENSIONS = Object.freeze(new Set([
  '.mp3', '.wav', '.m4a', '.ogg', '.webm',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'
]));

const CONTENT_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
});

const PRACTICE_MODES = Object.freeze([
  { id: 'RA', roots: ['public/database/RA/Voice/audio', 'public/database/RA/speech-coach-audio/v1/clips'] },
  { id: 'SST', roots: ['public/database/SST/audio'] },
  { id: 'RFIB', roots: ['public/database/RFIB'] },
  { id: 'collo-dictate', roots: ['public/database/collo-dictate'] },
  { id: 'type', roots: ['public/database/type'] },
  { id: 'speak', roots: ['public/database/speak'] },
  { id: 'Describe Image', roots: ['public/database/Describe Image'] },
  { id: 'Highlight Incorrect Words', roots: ['public/database/Highlight Incorrect Words/audio'] },
  { id: 'Take Notes', roots: ['public/database/Take Notes'] },
  { id: 'SMW', roots: ['public/database/SMW'] },
  { id: 'LMCSA', roots: ['public/database/LMCSA'] },
  { id: 'LFIB', roots: ['public/database/LFIB'] },
  { id: 'LMCMA', roots: ['public/database/LMCMA'] },
  { id: 'HCS', roots: ['public/database/HCS'] },
  { id: 'RTS', roots: ['public/database/RTS'] },
  { id: 'shared-audio', roots: ['public/audio', 'public/database/entrance-test'] }
]);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function sha256String(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])])
  );
}

function formatJson(value) {
  return JSON.stringify(canonicalJson(value), null, 2) + '\n';
}

function listFilesRecursive(directory, basePath = '') {
  const results = [];
  if (!fs.existsSync(directory)) return results;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(directory, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, relativePath));
    } else if (entry.isFile()) {
      results.push({ relative: relativePath.replace(/\\/g, '/'), absolute: fullPath });
    }
  }
  return results;
}

function discoverModeAssets(projectRoot, modeConfig) {
  const discovered = [];
  const seenPaths = new Set();
  for (const relativeRoot of modeConfig.roots) {
    const absoluteRoot = path.join(projectRoot, ...relativeRoot.split('/'));
    if (!fs.existsSync(absoluteRoot)) continue;
    const files = listFilesRecursive(absoluteRoot);
    for (const file of files) {
      const ext = path.extname(file.relative).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(ext)) continue;
      const fullLogicalPath = `${relativeRoot}/${file.relative}`.replace(/\\/g, '/');
      if (seenPaths.has(fullLogicalPath)) continue;
      seenPaths.add(fullLogicalPath);

      const stat = fs.statSync(file.absolute);
      const sha256 = sha256File(file.absolute);
      const storageKey = `media/sha256/${sha256}${ext}`;
      discovered.push({
        logicalPath: fullLogicalPath,
        storageKey,
        sha256,
        size: stat.size,
        contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        mode: modeConfig.id,
        absolutePath: file.absolute
      });
    }
  }
  return discovered;
}

function buildInventory(projectRoot, options = {}) {
  const cohort = options.cohort ? String(options.cohort).trim() : null;
  const modesToScan = cohort
    ? PRACTICE_MODES.filter((m) => m.id.toLowerCase() === cohort.toLowerCase())
    : PRACTICE_MODES;

  if (cohort && modesToScan.length === 0) {
    throw new Error(`Unknown cohort mode: '${cohort}'. Supported modes: ${PRACTICE_MODES.map((m) => m.id).join(', ')}`);
  }

  const allAssets = [];
  const uniqueObjects = new Map();
  const modeCatalogs = {};

  for (const modeConfig of modesToScan) {
    const assets = discoverModeAssets(projectRoot, modeConfig);
    allAssets.push(...assets);
    modeCatalogs[modeConfig.id] = assets;
    for (const asset of assets) {
      if (!uniqueObjects.has(asset.storageKey)) {
        uniqueObjects.set(asset.storageKey, {
          storageKey: asset.storageKey,
          sha256: asset.sha256,
          size: asset.size,
          contentType: asset.contentType,
          absolutePath: asset.absolutePath,
          logicalPaths: [asset.logicalPath]
        });
      } else {
        uniqueObjects.get(asset.storageKey).logicalPaths.push(asset.logicalPath);
      }
    }
  }

  const totalBytes = allAssets.reduce((sum, a) => sum + a.size, 0);
  const uniqueBytes = Array.from(uniqueObjects.values()).reduce((sum, o) => sum + o.size, 0);

  return {
    modes: modesToScan.map((m) => m.id),
    allAssets,
    uniqueObjects,
    modeCatalogs,
    stats: {
      totalLogicalAssets: allAssets.length,
      uniqueStorageObjects: uniqueObjects.size,
      totalLogicalBytes: totalBytes,
      uniqueStorageBytes: uniqueBytes,
      deduplicationSavingsBytes: totalBytes - uniqueBytes,
      deduplicatedCount: allAssets.length - uniqueObjects.size
    }
  };
}

function generatePublicationId(prefix = 'pub') {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const nonce = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${dateStr}-${nonce}`;
}

function buildCatalogs(inventory, publicationId, options = {}) {
  const deliveryBaseUrl = options.deliveryBaseUrl || DEFAULT_DELIVERY_BASE_URL;
  const shards = {};
  const shardPayloads = {};

  for (const [modeId, assets] of Object.entries(inventory.modeCatalogs)) {
    const shardKey = `catalogs/${publicationId}/${modeId}.json`;
    const catalogData = {
      schemaVersion: 1,
      publicationId,
      mode: modeId,
      createdAt: new Date().toISOString(),
      assetCount: assets.length,
      assets: Object.fromEntries(
        assets.map((a) => [
          a.logicalPath,
          {
            key: a.storageKey,
            sha256: a.sha256,
            size: a.size,
            contentType: a.contentType
          }
        ])
      )
    };
    const payload = formatJson(catalogData);
    const sha256 = sha256String(payload);
    shards[modeId] = {
      shardKey,
      sha256,
      size: Buffer.byteLength(payload, 'utf8'),
      assetCount: assets.length
    };
    shardPayloads[shardKey] = payload;
  }

  const rootRelease = {
    schemaVersion: 1,
    publicationId,
    createdAt: new Date().toISOString(),
    deliveryBaseUrl,
    summary: {
      totalLogicalAssets: inventory.stats.totalLogicalAssets,
      uniqueStorageObjects: inventory.stats.uniqueStorageObjects,
      totalLogicalBytes: inventory.stats.totalLogicalBytes,
      uniqueStorageBytes: inventory.stats.uniqueStorageBytes,
      deduplicationSavingsBytes: inventory.stats.deduplicationSavingsBytes,
      modesCount: Object.keys(shards).length
    },
    shards
  };

  const rootReleasePayload = formatJson(rootRelease);
  const rootReleaseKey = `publications/${publicationId}/release.json`;

  return {
    publicationId,
    rootRelease,
    rootReleaseKey,
    rootReleasePayload,
    shards,
    shardPayloads
  };
}

class CheckpointManager {
  constructor(checkpointDir, publicationId) {
    this.dir = checkpointDir;
    this.publicationId = publicationId;
    this.filePath = path.join(checkpointDir, `${publicationId}.json`);
    this.data = {
      publicationId,
      startedAt: new Date().toISOString(),
      completedObjects: {},
      completedShards: {},
      rootPublished: false
    };
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
      } catch (_) {
        // Fallback to fresh data on parse error
      }
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }

  isObjectCompleted(storageKey) {
    return Boolean(this.data.completedObjects[storageKey]);
  }

  recordObjectCompleted(storageKey, details = {}) {
    this.data.completedObjects[storageKey] = {
      completedAt: new Date().toISOString(),
      sha256: details.sha256,
      size: details.size
    };
    this.save();
  }

  isShardCompleted(shardKey) {
    return Boolean(this.data.completedShards[shardKey]);
  }

  recordShardCompleted(shardKey, sha256) {
    this.data.completedShards[shardKey] = {
      completedAt: new Date().toISOString(),
      sha256
    };
    this.save();
  }

  recordRootPublished() {
    this.data.rootPublished = true;
    this.data.finishedAt = new Date().toISOString();
    this.save();
  }
}

async function runPlanCommand(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const inventory = buildInventory(projectRoot, options);
  const publicationId = generatePublicationId('plan');
  const catalogs = buildCatalogs(inventory, publicationId, options);

  console.log('================================================================');
  console.log(' BEL Media Publication Plan (Dry-Run)');
  console.log('================================================================');
  console.log(`Publication ID:    ${publicationId}`);
  console.log(`Scanned Modes:     ${inventory.modes.join(', ')}`);
  console.log(`Total Assets:      ${inventory.stats.totalLogicalAssets.toLocaleString()}`);
  console.log(`Unique Objects:    ${inventory.stats.uniqueStorageObjects.toLocaleString()}`);
  console.log(`Total Media Size:  ${(inventory.stats.totalLogicalBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Unique Media Size: ${(inventory.stats.uniqueStorageBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Deduplication:     ${inventory.stats.deduplicatedCount} clips saved (${(inventory.stats.deduplicationSavingsBytes / (1024 * 1024)).toFixed(2)} MB)`);
  console.log('----------------------------------------------------------------');
  console.log('Catalog Shards:');
  for (const [modeId, shard] of Object.entries(catalogs.shards)) {
    console.log(`  - ${modeId.padEnd(25)} ${String(shard.assetCount).padStart(6)} assets -> ${shard.shardKey} (${(shard.size / 1024).toFixed(1)} KB)`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`Root Release File: ${catalogs.rootReleaseKey}`);
  console.log('Plan completed. Zero remote requests made.');
  console.log('================================================================');

  return { inventory, catalogs };
}

async function runPublishCommand(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const dryRun = Boolean(options.dryRun);
  const checkpointDir = path.resolve(options.checkpointDir || path.join(projectRoot, '.media-checkpoints'));
  const publicationId = options.publicationId || generatePublicationId('pub');
  const bucketName = options.bucketName || DEFAULT_BUCKET_NAME;

  console.log('================================================================');
  console.log(` BEL Media Publisher: ${dryRun ? '[DRY-RUN]' : '[LIVE UPLOAD]'}`);
  console.log('================================================================');
  console.log(`Publication ID: ${publicationId}`);
  console.log(`Target Bucket:  gs://${bucketName}`);
  console.log(`Checkpoint Dir: ${checkpointDir}`);

  const inventory = buildInventory(projectRoot, options);
  const catalogs = buildCatalogs(inventory, publicationId, options);
  const checkpoint = new CheckpointManager(checkpointDir, publicationId);

  const objectsToUpload = Array.from(inventory.uniqueObjects.values()).filter(
    (obj) => !checkpoint.isObjectCompleted(obj.storageKey)
  );

  console.log(`Total Objects:      ${inventory.stats.uniqueStorageObjects}`);
  console.log(`Already Completed:  ${inventory.stats.uniqueStorageObjects - objectsToUpload.length}`);
  console.log(`Pending Uploads:    ${objectsToUpload.length}`);

  if (dryRun) {
    console.log('----------------------------------------------------------------');
    console.log('DRY-RUN mode active: Skipping GCS uploads.');
    console.log(`Would upload ${objectsToUpload.length} content-addressed objects.`);
    console.log(`Would upload ${Object.keys(catalogs.shardPayloads).length} catalog shards.`);
    console.log(`Would upload root publication: ${catalogs.rootReleaseKey}`);
    console.log('================================================================');
    return {
      publicationId,
      dryRun: true,
      pendingObjects: objectsToUpload.length,
      shardsCount: Object.keys(catalogs.shardPayloads).length
    };
  }

  // Live upload requires Storage client
  let StorageClient;
  try {
    const gcs = require('@google-cloud/storage');
    StorageClient = gcs.Storage;
  } catch (err) {
    throw new Error(`@google-cloud/storage is required for live uploads: ${err.message}`);
  }

  const storage = new StorageClient({ projectId: options.projectId || DEFAULT_PROJECT_ID });
  const bucket = storage.bucket(bucketName);

  // Upload Objects with create-only preconditions
  let uploadedCount = 0;
  for (const obj of objectsToUpload) {
    const file = bucket.file(obj.storageKey);
    try {
      await bucket.upload(obj.absolutePath, {
        destination: obj.storageKey,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: obj.contentType,
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: {
            sha256: obj.sha256
          }
        }
      });
      checkpoint.recordObjectCompleted(obj.storageKey, { sha256: obj.sha256, size: obj.size });
      uploadedCount++;
    } catch (err) {
      if (err.code === 412) {
        // Precondition failed: object already exists. Verify existing bytes.
        const [metadata] = await file.getMetadata();
        if (Number(metadata.size) === obj.size) {
          checkpoint.recordObjectCompleted(obj.storageKey, { sha256: obj.sha256, size: obj.size });
          uploadedCount++;
          continue;
        }
        throw new Error(`Object collision at ${obj.storageKey}: remote size (${metadata.size}) != local size (${obj.size})`);
      }
      throw err;
    }
  }

  // Upload Catalog Shards
  for (const [shardKey, payload] of Object.entries(catalogs.shardPayloads)) {
    if (checkpoint.isShardCompleted(shardKey)) continue;
    const file = bucket.file(shardKey);
    await file.save(payload, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable'
    });
    checkpoint.recordShardCompleted(shardKey, sha256String(payload));
  }

  // Upload Root Release Record
  const rootFile = bucket.file(catalogs.rootReleaseKey);
  await rootFile.save(catalogs.rootReleasePayload, {
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable'
  });
  checkpoint.recordRootPublished();

  console.log('----------------------------------------------------------------');
  console.log(`Successfully published publication: ${publicationId}`);
  console.log(`Uploaded Objects: ${uploadedCount}`);
  console.log(`Catalogs Emitted: ${Object.keys(catalogs.shards).length}`);
  console.log('================================================================');

  return {
    publicationId,
    dryRun: false,
    uploadedCount,
    shardsCount: Object.keys(catalogs.shards).length,
    rootReleaseKey: catalogs.rootReleaseKey
  };
}

function parseCliArgs(args) {
  const parsed = {
    command: 'plan',
    dryRun: false,
    cohort: null,
    projectRoot: null,
    publicationId: null,
    bucketName: null
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--cohort' && args[i + 1]) parsed.cohort = args[++i];
    else if (arg === '--project-root' && args[i + 1]) parsed.projectRoot = args[++i];
    else if (arg === '--publication-id' && args[i + 1]) parsed.publicationId = args[++i];
    else if (arg === '--bucket' && args[i + 1]) parsed.bucketName = args[++i];
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length > 0) {
    parsed.command = positional[0];
  }

  return parsed;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === 'plan') {
    await runPlanCommand(args);
  } else if (args.command === 'publish') {
    await runPublishCommand(args);
  } else {
    console.error(`Unknown command: ${args.command}. Use 'plan' or 'publish'.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  PRACTICE_MODES,
  MEDIA_EXTENSIONS,
  CONTENT_TYPES,
  DEFAULT_BUCKET_NAME,
  DEFAULT_DELIVERY_BASE_URL,
  sha256File,
  sha256String,
  canonicalJson,
  formatJson,
  discoverModeAssets,
  buildInventory,
  buildCatalogs,
  generatePublicationId,
  CheckpointManager,
  runPlanCommand,
  runPublishCommand
};
