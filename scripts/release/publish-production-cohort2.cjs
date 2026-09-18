'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { OAuth2Client } = require('google-auth-library');

const EXPECTED_OPERATOR = 'huathanhnam95@gmail.com';
const TARGET_PROJECT_ID = 'listening-tasks-3ae34';
const TARGET_BUCKET_NAME = 'listening-tasks-3ae34-practice-media';
const TARGET_BUCKET_LOCATION = 'ASIA-SOUTHEAST1';
const DEFAULT_DELIVERY_BASE_URL = `https://storage.googleapis.com/${TARGET_BUCKET_NAME}/`;
const PUBLICATION_ID = 'pub-20260918-all-media';
const BASE_PUBLICATION_ID = 'pub-20260918-ra-sst';

class GCloudOAuth2Client extends OAuth2Client {
  constructor() {
    super();
    this.token = null;
    this.expiresAt = 0;
  }

  refreshToken() {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : 'gcloud';
    const args = isWin ? ['/c', 'gcloud', 'auth', 'print-access-token'] : ['auth', 'print-access-token'];
    const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (res.status !== 0) {
      throw new Error(`Failed to obtain access token from gcloud CLI: ${res.stderr}`);
    }
    this.token = res.stdout.trim();
    this.expiresAt = Date.now() + 3500 * 1000;
    this.setCredentials({ access_token: this.token });
    return this.token;
  }

  async getAccessToken() {
    if (!this.token || Date.now() >= this.expiresAt - 60000) {
      this.refreshToken();
    }
    return { token: this.token };
  }

  async getRequestMetadataAsync() {
    if (!this.token || Date.now() >= this.expiresAt - 60000) {
      this.refreshToken();
    }
    return {
      headers: {
        Authorization: `Bearer ${this.token}`
      }
    };
  }
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const CHECKPOINT_DIR = path.join(REPO_ROOT, '.media-checkpoints', PUBLICATION_ID);

const SOURCE_MEDIA_ROOT = fs.existsSync('C:/Cursor AI/public/database/Highlight Incorrect Words/audio/1')
  ? 'C:/Cursor AI'
  : REPO_ROOT;

const MEDIA_EXTS = Object.freeze(new Set(['.mp3', '.wav', '.png', '.jpg', '.jpeg', '.webm', '.ogg']));

const COHORT2_MODE_ROOTS = Object.freeze([
  { mode: 'RFIB', shardName: 'RFIB', relRoot: 'public/database/RFIB/audio' },
  { mode: 'Highlight Incorrect Words', shardName: 'HIW', relRoot: 'public/database/Highlight Incorrect Words/audio' },
  { mode: 'Take Notes', shardName: 'Take-Notes', relRoot: 'public/database/Take Notes/RL/audio' },
  { mode: 'collo-dictate', shardName: 'collo-dictate', relRoot: 'public/database/collo-dictate/audio' },
  { mode: 'Describe Image', shardName: 'Describe-Image', relRoot: 'public/database/Describe Image/DI' },
  { mode: 'LMCMA', shardName: 'LMCMA', relRoot: 'public/database/LMCMA/audio' },
  { mode: 'LMCSA', shardName: 'LMCSA', relRoot: 'public/database/LMCSA/audio' },
  { mode: 'HCS', shardName: 'HCS', relRoot: 'public/database/HCS/audio' },
  { mode: 'type', shardName: 'type', relRoot: 'public/database/type/audio' },
  { mode: 'SMW', shardName: 'SMW', relRoot: 'public/database/SMW/audio' },
  { mode: 'speak', shardName: 'speak', relRoot: 'public/database/speak/audio' },
  { mode: 'extended', shardName: 'extended', relRoot: 'public/database/extended/audio' },
  { mode: 'LFIB', shardName: 'LFIB', relRoot: 'public/database/LFIB/audio' },
  { mode: 'SGD', shardName: 'SGD', relRoot: 'public/database/SGD/audio' },
  { mode: 'quiz', shardName: 'quiz', relRoot: 'public/database/quiz/ASQ' },
  { mode: 'RTS', shardName: 'RTS', relRoot: 'public/database/RTS/audio' },
  { mode: 'Entrance Test', shardName: 'Entrance-Test', relRoot: 'public/database/Entrance Test' },
  { mode: 'echo-forge', shardName: 'echo-forge', relRoot: 'public/database/echo-forge/audio' }
]);

function getContentType(ext) {
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webm': return 'audio/webm';
    case '.ogg': return 'audio/ogg';
    default: return 'application/octet-stream';
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  let bytesRead;
  try {
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) !== 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function sha256String(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function invokeGCloud(args) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'gcloud';
  const fullArgs = isWin ? ['/c', 'gcloud', ...args] : args;
  const res = spawnSync(cmd, fullArgs, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false
  });
  return {
    exitCode: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim()
  };
}

function verifyOperatorEnvironment() {
  const accountRes = invokeGCloud(['config', 'get-value', 'account']);
  const currentAccount = accountRes.stdout.trim();
  if (currentAccount !== EXPECTED_OPERATOR) {
    throw new Error(`[Preflight] Operator account mismatch: expected '${EXPECTED_OPERATOR}', found '${currentAccount}'`);
  }

  const bktRes = invokeGCloud([
    'storage', 'buckets', 'describe',
    `gs://${TARGET_BUCKET_NAME}`,
    `--project=${TARGET_PROJECT_ID}`,
    '--format=value(location)'
  ]);
  if (bktRes.exitCode !== 0) {
    throw new Error(`[Preflight] Target bucket gs://${TARGET_BUCKET_NAME} inaccessible: ${bktRes.stderr}`);
  }
  const location = bktRes.stdout.trim().toUpperCase();
  if (location !== TARGET_BUCKET_LOCATION) {
    throw new Error(`[Preflight] Target bucket location mismatch: expected '${TARGET_BUCKET_LOCATION}', found '${location}'`);
  }

  return { account: currentAccount, bucket: TARGET_BUCKET_NAME, project: TARGET_PROJECT_ID, location };
}

function scanMediaDirectories(root) {
  const items = [];

  function walk(dir, relPrefix, modeConfig) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = `${relPrefix}/${entry.name}`.replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(fullPath, relPath, modeConfig);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (MEDIA_EXTS.has(ext)) {
          const stat = fs.statSync(fullPath);
          items.push({
            fullPath,
            relPath,
            size: stat.size,
            mode: modeConfig.mode,
            shardName: modeConfig.shardName,
            ext,
            contentType: getContentType(ext)
          });
        }
      }
    }
  }

  for (const r of COHORT2_MODE_ROOTS) {
    walk(path.join(root, r.relRoot), r.relRoot, r);
  }

  return items;
}

class ResumableCheckpoint {
  constructor(checkpointDir, publicationId) {
    this.dir = checkpointDir;
    this.filePath = path.join(checkpointDir, 'checkpoint.json');
    this.data = {
      publicationId,
      startedAt: new Date().toISOString(),
      completedObjects: {},
      stats: { uploaded: 0, reused: 0, totalBytesUploaded: 0 }
    };
    this.dirty = false;
    this.lastFlush = Date.now();
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
      } catch (_) {}
    }
  }

  isCompleted(storageKey) {
    return Boolean(this.data.completedObjects[storageKey]);
  }

  record(storageKey, details) {
    this.data.completedObjects[storageKey] = {
      completedAt: new Date().toISOString(),
      action: details.action,
      generation: details.generation,
      sha256: details.sha256,
      size: details.size
    };
    if (details.action === 'uploaded') {
      this.data.stats.uploaded = (this.data.stats.uploaded || 0) + 1;
      this.data.stats.totalBytesUploaded = (this.data.stats.totalBytesUploaded || 0) + details.size;
    } else {
      this.data.stats.reused = (this.data.stats.reused || 0) + 1;
    }
    this.dirty = true;
    if (Date.now() - this.lastFlush > 2000) {
      this.flush();
    }
  }

  flush() {
    if (!this.dirty) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
    this.dirty = false;
    this.lastFlush = Date.now();
  }
}

async function verifyRemoteHttp(url, expected) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return resolve({ ok: false, error: `HTTP ${res.statusCode} ${res.statusMessage}` });
      }
      const headers = res.headers;
      const hash = crypto.createHash('sha256');
      let bytesRead = 0;
      res.on('data', (chunk) => {
        bytesRead += chunk.length;
        hash.update(chunk);
      });
      res.on('end', () => {
        const digest = hash.digest('hex');
        resolve({
          ok: bytesRead === expected.size && digest === expected.sha256,
          statusCode: res.statusCode,
          contentType: headers['content-type'],
          cacheControl: headers['cache-control'],
          cors: headers['access-control-allow-origin'],
          bytesRead,
          digest
        });
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const preflightOnly = !apply || args.includes('--preflight');
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 24;

  console.log('================================================================');
  console.log(` BEL Production Cohort 2 Publisher: [${apply ? 'LIVE APPLY' : 'READ-ONLY PREFLIGHT'}]`);
  console.log('================================================================');
  console.log(`Publication ID:    ${PUBLICATION_ID}`);
  console.log(`Base Publication:  ${BASE_PUBLICATION_ID}`);
  console.log(`Target Bucket:     gs://${TARGET_BUCKET_NAME}`);
  console.log(`Target Project:    ${TARGET_PROJECT_ID}`);
  console.log(`Expected Operator: ${EXPECTED_OPERATOR}`);
  console.log('----------------------------------------------------------------');

  // 1. Verify operator credentials & environment
  console.log('[1/5] Verifying operator authorization and bucket preflight...');
  const env = verifyOperatorEnvironment();
  console.log(`      Authorized Account: ${env.account}`);
  console.log(`      Verified Bucket:    gs://${env.bucket} (${env.location})`);

  // 2. Discover media assets across the 18 modes
  console.log(`[2/5] Scanning Cohort 2 media directories in ${SOURCE_MEDIA_ROOT}...`);
  const items = scanMediaDirectories(SOURCE_MEDIA_ROOT);
  console.log(`      Total Discovered Cohort 2 Media Files: ${items.length.toLocaleString()}`);

  const modeAssetsMap = new Map();
  for (const item of items) {
    if (!modeAssetsMap.has(item.shardName)) {
      modeAssetsMap.set(item.shardName, []);
    }
    modeAssetsMap.get(item.shardName).push(item);
  }

  for (const [shardName, list] of modeAssetsMap.entries()) {
    console.log(`      - ${shardName.padEnd(16)}: ${list.length.toLocaleString()} files`);
  }

  // 3. Compute digests and index unique storage objects
  console.log('[3/5] Indexing unique storage objects by SHA-256...');
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const inventoryCachePath = path.join(CHECKPOINT_DIR, 'inventory.json');
  let cachedInventory = null;
  if (fs.existsSync(inventoryCachePath)) {
    try {
      cachedInventory = JSON.parse(fs.readFileSync(inventoryCachePath, 'utf8'));
      console.log('      Loaded cached inventory index from disk.');
    } catch (_) {}
  }

  const uniqueObjects = new Map();
  let totalBytes = 0;

  if (cachedInventory && cachedInventory.items && cachedInventory.items.length === items.length) {
    const itemMap = new Map(cachedInventory.items.map((c) => [c.relPath, c]));
    for (const item of items) {
      const cached = itemMap.get(item.relPath);
      if (cached) {
        item.sha256 = cached.sha256;
        item.storageKey = cached.storageKey;
      }
      totalBytes += item.size;
      if (!uniqueObjects.has(item.storageKey)) {
        uniqueObjects.set(item.storageKey, {
          storageKey: item.storageKey,
          sha256: item.sha256,
          size: item.size,
          contentType: item.contentType,
          absolutePath: item.fullPath,
          logicalPaths: [item.relPath]
        });
      } else {
        uniqueObjects.get(item.storageKey).logicalPaths.push(item.relPath);
      }
    }
  } else {
    const cachedItems = [];
    for (const item of items) {
      totalBytes += item.size;
      const sha = sha256File(item.fullPath);
      item.sha256 = sha;
      item.storageKey = `media/sha256/${sha}${item.ext}`;
      if (!uniqueObjects.has(item.storageKey)) {
        uniqueObjects.set(item.storageKey, {
          storageKey: item.storageKey,
          sha256: sha,
          size: item.size,
          contentType: item.contentType,
          absolutePath: item.fullPath,
          logicalPaths: [item.relPath]
        });
      } else {
        uniqueObjects.get(item.storageKey).logicalPaths.push(item.relPath);
      }
      cachedItems.push({
        fullPath: item.fullPath,
        relPath: item.relPath,
        size: item.size,
        ext: item.ext,
        mode: item.mode,
        shardName: item.shardName,
        contentType: item.contentType,
        sha256: sha,
        storageKey: item.storageKey,
        logicalPaths: uniqueObjects.get(item.storageKey).logicalPaths
      });
    }
    fs.writeFileSync(inventoryCachePath, JSON.stringify({ items: cachedItems }, null, 2), 'utf8');
  }

  const uniqueBytes = Array.from(uniqueObjects.values()).reduce((s, o) => s + o.size, 0);
  const dupCount = items.length - uniqueObjects.size;
  const dupBytes = totalBytes - uniqueBytes;

  console.log(`      Unique Content Objects: ${uniqueObjects.size.toLocaleString()}`);
  console.log(`      Total Logical Bytes:    ${totalBytes.toLocaleString()} (${(totalBytes / (1024 * 1024 * 1024)).toFixed(3)} GB)`);
  console.log(`      Unique Storage Bytes:   ${uniqueBytes.toLocaleString()} (${(uniqueBytes / (1024 * 1024 * 1024)).toFixed(3)} GB)`);
  console.log(`      Duplicate Files:        ${dupCount.toLocaleString()} (${(dupBytes / (1024 * 1024)).toFixed(2)} MB avoided)`);

  const checkpoint = new ResumableCheckpoint(CHECKPOINT_DIR, PUBLICATION_ID);
  const pendingObjects = Array.from(uniqueObjects.values()).filter((o) => !checkpoint.isCompleted(o.storageKey));
  const completedCount = uniqueObjects.size - pendingObjects.length;

  console.log(`      Already in Checkpoint:  ${completedCount.toLocaleString()} objects`);
  console.log(`      Pending Upload / Verification: ${pendingObjects.length.toLocaleString()} objects`);

  if (preflightOnly) {
    console.log('----------------------------------------------------------------');
    console.log('[PREFLIGHT COMPLETE] Read-only verification succeeded.');
    console.log(`To execute upload, run with --apply:`);
    console.log(`  node scripts/release/publish-production-cohort2.cjs --apply`);
    console.log('================================================================');
    return;
  }

  // 4. Live Execution
  console.log(`[4/5] Executing parallel uploads with concurrency ${CONCURRENCY}...`);
  const { Storage } = require('@google-cloud/storage');
  process.env.GCS_METADATA_TIMEOUT = '0';
  const authClient = new GCloudOAuth2Client();
  authClient.refreshToken();
  const storage = new Storage({ projectId: TARGET_PROJECT_ID, authClient });
  const bucket = storage.bucket(TARGET_BUCKET_NAME);

  process.on('SIGINT', () => {
    console.log('\n[INTERRUPT] Caught SIGINT. Flushing checkpoint before exit...');
    checkpoint.flush();
    process.exit(130);
  });

  let cursor = 0;
  let processedCount = completedCount;
  const startTime = Date.now();
  let lastReportTime = startTime;
  let lastReportCount = processedCount;

  async function uploadWorker(obj) {
    const file = bucket.file(obj.storageKey);
    let attempt = 0;
    while (attempt < 4) {
      attempt++;
      try {
        const [uploadRes] = await bucket.upload(obj.absolutePath, {
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
        checkpoint.record(obj.storageKey, {
          action: 'uploaded',
          generation: uploadRes ? uploadRes.metadata.generation : 'unknown',
          sha256: obj.sha256,
          size: obj.size
        });
        return;
      } catch (err) {
        if (err.code === 412 || String(err.message).includes('412') || String(err.message).includes('Precondition')) {
          const [metadata] = await file.getMetadata();
          if (Number(metadata.size) === obj.size) {
            checkpoint.record(obj.storageKey, {
              action: 'reused',
              generation: metadata.generation,
              sha256: obj.sha256,
              size: obj.size
            });
            return;
          }
          throw new Error(`[Object Collision] ${obj.storageKey}: remote size (${metadata.size}) != local size (${obj.size})`);
        }
        if (attempt < 4 && (err.code === 429 || err.code === 503 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
          const delay = Math.pow(2, attempt) * 500;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  const pool = [];
  for (let i = 0; i < Math.min(CONCURRENCY, pendingObjects.length); i++) {
    pool.push(
      (async function runNext() {
        while (cursor < pendingObjects.length) {
          const idx = cursor++;
          const obj = pendingObjects[idx];
          await uploadWorker(obj);
          processedCount++;

          const now = Date.now();
          if (now - lastReportTime >= 5000 || processedCount === uniqueObjects.size) {
            const deltaSec = (now - lastReportTime) / 1000;
            const deltaItems = processedCount - lastReportCount;
            const rate = deltaSec > 0 ? (deltaItems / deltaSec).toFixed(1) : '0';
            const remaining = uniqueObjects.size - processedCount;
            const etaSec = deltaSec > 0 && deltaItems > 0 ? Math.round(remaining / (deltaItems / deltaSec)) : 0;
            const etaMin = Math.floor(etaSec / 60);
            const etaRemSec = etaSec % 60;
            const percent = ((processedCount / uniqueObjects.size) * 100).toFixed(1);
            console.log(`      [Progress: ${processedCount.toLocaleString()} / ${uniqueObjects.size.toLocaleString()} (${percent}%)] [Rate: ${rate} obj/s] [ETA: ${etaMin}m ${etaRemSec}s]`);
            lastReportTime = now;
            lastReportCount = processedCount;
          }
        }
      })()
    );
  }

  await Promise.all(pool);
  checkpoint.flush();
  console.log(`      All ${uniqueObjects.size.toLocaleString()} content objects verified/uploaded successfully.`);

  // 5. Generate and upload sharded catalogs & cumulative release.json
  console.log('[5/5] Generating sharded catalogs and root release manifest...');
  const shards = {};
  const localCatalogDir = path.join(REPO_ROOT, 'public/catalogs', PUBLICATION_ID);
  const localReleaseDir = path.join(REPO_ROOT, 'public/publications', PUBLICATION_ID);
  fs.mkdirSync(localCatalogDir, { recursive: true });
  fs.mkdirSync(localReleaseDir, { recursive: true });

  // 5a. Copy forward verified RA and SST catalogs from base publication
  const baseCatalogDir = path.join(REPO_ROOT, 'public/catalogs', BASE_PUBLICATION_ID);
  for (const baseMode of ['RA', 'SST']) {
    const baseFile = path.join(baseCatalogDir, `${baseMode}.json`);
    if (fs.existsSync(baseFile)) {
      const baseContent = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
      baseContent.publicationId = PUBLICATION_ID;
      baseContent.createdAt = new Date().toISOString();
      const payload = JSON.stringify(baseContent, null, 2) + '\n';
      const sha = sha256String(payload);
      const shardKey = `catalogs/${PUBLICATION_ID}/${baseMode}.json`;
      shards[baseMode] = {
        shardKey,
        sha256: sha,
        size: Buffer.byteLength(payload, 'utf8'),
        assetCount: baseContent.assetCount
      };
      fs.writeFileSync(path.join(localCatalogDir, `${baseMode}.json`), payload, 'utf8');
      await bucket.file(shardKey).save(payload, {
        contentType: 'application/json',
        cacheControl: 'public, max-age=31536000, immutable'
      });
      console.log(`      Reused ${baseMode} Shard: ${baseContent.assetCount.toLocaleString()} assets -> ${shardKey}`);
    }
  }

  // 5b. Generate shards for all 18 Cohort 2 modes
  for (const [shardName, modeItems] of modeAssetsMap.entries()) {
    const catalog = {
      schemaVersion: 1,
      publicationId: PUBLICATION_ID,
      mode: shardName,
      ineligibleForProduction: false,
      createdAt: new Date().toISOString(),
      assetCount: modeItems.length,
      assets: Object.fromEntries(
        modeItems.map((a) => [
          a.relPath,
          {
            key: a.storageKey,
            sha256: a.sha256,
            size: a.size,
            contentType: a.contentType
          }
        ])
      )
    };
    const payload = JSON.stringify(catalog, null, 2) + '\n';
    const sha = sha256String(payload);
    const shardKey = `catalogs/${PUBLICATION_ID}/${shardName}.json`;
    shards[shardName] = {
      shardKey,
      sha256: sha,
      size: Buffer.byteLength(payload, 'utf8'),
      assetCount: modeItems.length
    };
    fs.writeFileSync(path.join(localCatalogDir, `${shardName}.json`), payload, 'utf8');
    await bucket.file(shardKey).save(payload, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable'
    });
    console.log(`      Emitted ${shardName.padEnd(16)}: ${modeItems.length.toLocaleString()} assets -> ${shardKey} (${(shards[shardName].size / 1024).toFixed(1)} KB)`);
  }

  // 5c. Root Cumulative Release Record
  const totalLogicalAssets = Object.values(shards).reduce((s, sh) => s + sh.assetCount, 0);
  const rootRelease = {
    schemaVersion: 1,
    publicationId: PUBLICATION_ID,
    type: 'production',
    ineligibleForProduction: false,
    selectionRestricted: false,
    createdAt: new Date().toISOString(),
    deliveryBaseUrl: DEFAULT_DELIVERY_BASE_URL,
    summary: {
      totalLogicalAssets,
      uniqueStorageObjects: uniqueObjects.size,
      totalLogicalBytes: totalBytes,
      uniqueStorageBytes: uniqueBytes,
      deduplicationSavingsBytes: dupBytes,
      modesCount: Object.keys(shards).length
    },
    shards
  };
  const rootReleasePayload = JSON.stringify(rootRelease, null, 2) + '\n';
  const rootReleaseKey = `publications/${PUBLICATION_ID}/release.json`;
  fs.writeFileSync(path.join(localReleaseDir, 'release.json'), rootReleasePayload, 'utf8');
  await bucket.file(rootReleaseKey).save(rootReleasePayload, {
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable'
  });
  console.log(`      Emitted Root Release: ${rootReleaseKey}`);

  // Sample Readback Verification
  console.log('\n--- SAMPLE READBACK HTTP VERIFICATION (COHORT 2) ---');
  const sampleItems = [];
  for (const [shardName, modeItems] of modeAssetsMap.entries()) {
    if (modeItems.length > 0) {
      sampleItems.push(modeItems[0]);
    }
  }

  for (const s of sampleItems) {
    const url = `${DEFAULT_DELIVERY_BASE_URL}${s.storageKey}`;
    const check = await verifyRemoteHttp(url, { size: s.size, sha256: s.sha256 });
    if (!check.ok) {
      throw new Error(`[Readback Failed] Object ${s.storageKey} failed readback: ${check.error || 'digest mismatch'}`);
    }
    console.log(`  [VERIFIED] ${s.relPath.padEnd(65)} -> HTTP 200, CORS: ${check.cors}, SHA256 match`);
  }

  // Write publication receipt
  const receipt = {
    publicationId: PUBLICATION_ID,
    executedAt: new Date().toISOString(),
    operator: env.account,
    targetBucket: env.bucket,
    targetProject: env.project,
    totalLogicalAssets,
    uniqueStorageObjects: uniqueObjects.size,
    reusedObjects: checkpoint.data.stats.reused || 0,
    uploadedObjects: checkpoint.data.stats.uploaded || 0,
    totalBytes,
    uniqueBytes,
    rootReleaseKey,
    shards
  };
  fs.writeFileSync(path.join(CHECKPOINT_DIR, 'publication-receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');
  console.log('\n================================================================');
  console.log(` PUBLICATION SUCCESSFUL: ${PUBLICATION_ID}`);
  console.log(` Receipt saved: ${path.join(CHECKPOINT_DIR, 'publication-receipt.json')}`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
