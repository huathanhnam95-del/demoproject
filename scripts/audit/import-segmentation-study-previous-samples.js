/* eslint-disable no-console */

// Idempotent seed helper for the six historical pronunciation samples and the
// checked-in study-v1 task manifest. It is intentionally dry-run by default;
// pass --apply only from an authenticated, allowlisted release checkout.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TASK_COLLECTION = 'pronunciationSegmentationStudyTasks';
const CORPUS_COLLECTION = 'pronunciationCorpusSamples';
const AUDIO_HASH_COLLECTION = 'pronunciationSegmentationStudyAudioHashes';
const STUDY_VERSION = 'study-v1';
const HISTORICAL_IDS = [
  'photograph-manual-review-20260809091453535-7b4913e7',
  'photograph-manual-review-20260811005358817-73add71e',
  'photograph-manual-review-20260811010309837-04dc4b2f',
  'photograph-manual-review-20260811013133753-ea8c7b3d',
  'photograph-manual-review-20260811043541473-18dec116',
  'recording-manual-review-20260812104521996-9b669377'
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args.set(token, true);
    else { args.set(token, next); index += 1; }
  }
  return args;
}

function readHistoricalSamples(samplesDir) {
  const rows = [];
  const seenHashes = new Set();
  for (const sampleId of HISTORICAL_IDS) {
    const jsonPath = path.join(samplesDir, `${sampleId}.json`);
    const wavPath = path.join(samplesDir, `${sampleId}.wav`);
    if (!fs.existsSync(jsonPath) || !fs.existsSync(wavPath)) {
      throw new Error(`Missing historical pair for ${sampleId}.`);
    }
    const document = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const audio = fs.readFileSync(wavPath);
    const sourceHash = sha256(audio);
    if (seenHashes.has(sourceHash)) continue;
    seenHashes.add(sourceHash);
    const review = document.manualReview || {};
    const analysis = document.analysis || {};
    const reference = document.reference || {};
    rows.push({
      sampleId,
      audio,
      sourceHash,
      targetWord: String(review.targetWord || document.word || '').trim().toLowerCase(),
      referenceIpa: String(review.referenceIpa || reference.rawIpa || '').trim(),
      referenceSyllableIpa: Array.isArray(review.referenceSyllableIpa) ? review.referenceSyllableIpa : [],
      targetSyllableCount: Number(review.targetSyllableCount || review.expectedObservedCount || 0),
      expectedObservedCount: Number(review.expectedObservedCount || review.targetSyllableCount || 0),
      legacyManualSegments: Array.isArray(review.manualSegments) ? review.manualSegments : [],
      automaticSegments: Array.isArray(analysis.automaticSegments) ? analysis.automaticSegments : [],
      legacySegmentationConvention: String(review.segmentationConvention || 'ipa-phonological'),
      sourceDocument: document
    });
  }
  if (rows.length !== 6) throw new Error(`Expected six unique historical WAVs, found ${rows.length}.`);
  return rows;
}

function loadManifest(manifestPath) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries) || entries.length !== 100) throw new Error('study-v1 manifest must contain exactly 100 entries.');
  return entries;
}

function buildTaskDocument(entry, timestamp) {
  return {
    studyVersion: STUDY_VERSION,
    taskId: entry.taskId,
    order: entry.order,
    split: entry.split,
    targetWord: entry.targetWord,
    referenceIpa: entry.referenceIpa,
    referenceSyllableIpa: entry.referenceSyllableIpa,
    targetSyllableCount: entry.targetSyllableCount,
    expectedObservedCount: entry.expectedObservedCount || entry.targetSyllableCount,
    transitionClasses: entry.transitionTypes || entry.transitionClasses || [],
    manifestSource: 'scripts/data/segmentation-study-v1.json',
    status: 'available',
    claim: null,
    claimExpiresAt: null,
    completedSampleId: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function buildCorpusDocument(sample, audioMeta, timestamp) {
  const review = sample.sourceDocument.manualReview || {};
  const analysis = sample.sourceDocument.analysis || {};
  return {
    sampleId: sample.sampleId,
    targetWord: sample.targetWord,
    referenceIpa: sample.referenceIpa,
    referenceSyllableIpa: sample.referenceSyllableIpa,
    expectedObservedCount: sample.expectedObservedCount,
    targetSyllableCount: sample.targetSyllableCount,
    category: 'clean',
    speakerCohort: 'segmentation-study-historical',
    studyVersion: STUDY_VERSION,
    studyPreviousSample: true,
    sourceKind: 'pronounce-mode-local',
    historicalSet: 'v4-accuracy-regression',
    sourceHash: sample.sourceHash,
    storagePath: `pronunciation-segmentation-corpus/${sample.sampleId}.wav`,
    contentType: 'audio/wav',
    bytes: sample.audio.length,
    durationSeconds: audioMeta.duration,
    sampleRate: audioMeta.sampleRate,
    channels: audioMeta.channels,
    bitsPerSample: audioMeta.bitsPerSample,
    // Preserve the old review without presenting it as the new contiguous
    // convention. The CRM reviewer creates an immutable new review later.
    legacyManualSegments: sample.legacyManualSegments,
    legacySegmentationConvention: sample.legacySegmentationConvention,
    automaticSegments: sample.automaticSegments,
    legacyAnalysis: analysis,
    reviewStatus: 'pending',
    needsManualReview: true,
    reviewReason: 'historical-study-re-review',
    legacyReviewMetadata: review,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function buildAudioHashDocument(sample, timestamp, sampleId = sample.sampleId) {
  return {
    sourceHash: sample.sourceHash,
    sampleId,
    studyVersion: STUDY_VERSION,
    sourceKind: 'pronounce-mode-local',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function historicalQueueMarker(timestamp) {
  return {
    studyVersion: STUDY_VERSION,
    studyPreviousSample: true,
    sourceKind: 'pronounce-mode-local',
    historicalSet: 'v4-accuracy-regression',
    needsManualReview: true,
    reviewStatus: 'pending',
    reviewReason: 'historical-study-re-review',
    updatedAt: timestamp
  };
}

async function applySeed({ samples, manifest }) {
  const { db, getStorageBucket } = require('../../functions/src/utils/firebase_admin_init');
  const bucket = await getStorageBucket();
  if (!bucket) throw new Error('Firebase Storage is not initialized.');
  const timestamp = new Date();
  let taskCreated = 0;
  let sampleCreated = 0;
  let sampleDeduplicated = 0;
  for (const entry of manifest) {
    const ref = db.collection(TASK_COLLECTION).doc(entry.taskId);
    const snapshot = await ref.get();
    if (!snapshot.exists) { await ref.set(buildTaskDocument(entry, timestamp)); taskCreated += 1; }
  }
  for (const sample of samples) {
    const ref = db.collection(CORPUS_COLLECTION).doc(sample.sampleId);
    const hashRef = db.collection(AUDIO_HASH_COLLECTION).doc(sample.sourceHash);
    const hashSnapshot = await hashRef.get();
    if (hashSnapshot.exists) {
      const existingSampleId = String(hashSnapshot.data()?.sampleId || '');
      if (!existingSampleId) throw new Error(`Invalid audio-hash registry entry for ${sample.sourceHash}.`);
      await db.collection(CORPUS_COLLECTION).doc(existingSampleId).set(historicalQueueMarker(timestamp), { merge: true });
      sampleDeduplicated += 1;
      continue;
    }

    const matchingSnapshot = await db.collection(CORPUS_COLLECTION).where('sourceHash', '==', sample.sourceHash).limit(1).get();
    if (!matchingSnapshot.empty) {
      const existingRef = matchingSnapshot.docs[0].ref;
      await db.runTransaction(async (transaction) => {
        const concurrentHash = await transaction.get(hashRef);
        if (concurrentHash.exists && concurrentHash.data()?.sampleId !== existingRef.id) {
          throw new Error(`Duplicate WAV SHA-256 ${sample.sourceHash}.`);
        }
        transaction.set(existingRef, historicalQueueMarker(timestamp), { merge: true });
        transaction.set(hashRef, buildAudioHashDocument(sample, timestamp, existingRef.id));
      });
      sampleDeduplicated += 1;
      continue;
    }

    const snapshot = await ref.get();
    if (snapshot.exists) {
      const existing = snapshot.data() || {};
      if (existing.sourceHash !== sample.sourceHash) throw new Error(`Hash conflict for existing ${sample.sampleId}.`);
      await db.runTransaction(async (transaction) => {
        const concurrentHash = await transaction.get(hashRef);
        if (concurrentHash.exists && concurrentHash.data()?.sampleId !== sample.sampleId) {
          throw new Error(`Duplicate WAV SHA-256 ${sample.sourceHash}.`);
        }
        transaction.set(ref, historicalQueueMarker(timestamp), { merge: true });
        transaction.set(hashRef, buildAudioHashDocument(sample, timestamp));
      });
      sampleDeduplicated += 1;
      continue;
    }
    const audioMeta = require('../../functions/src/routes/admin/pronunciation-corpus').validateWavBuffer(sample.audio);
    const storagePath = `pronunciation-segmentation-corpus/${sample.sampleId}.wav`;
    const audioFile = bucket.file(storagePath);
    await audioFile.save(sample.audio, { resumable: false, metadata: { contentType: 'audio/wav', metadata: { sourceHash: sample.sourceHash, studyVersion: STUDY_VERSION } } });
    try {
      await db.runTransaction(async (transaction) => {
        const concurrentHash = await transaction.get(hashRef);
        if (concurrentHash.exists) throw new Error(`Duplicate WAV SHA-256 ${sample.sourceHash}.`);
        transaction.create(ref, buildCorpusDocument(sample, audioMeta, timestamp));
        transaction.create(hashRef, buildAudioHashDocument(sample, timestamp));
      });
    } catch (error) {
      await audioFile.delete({ ignoreNotFound: true }).catch(() => {});
      throw error;
    }
    sampleCreated += 1;
  }
  return { taskCreated, sampleCreated, sampleDeduplicated };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = path.resolve(String(args.get('--root') || path.join(__dirname, '../..')));
  const samplesDir = path.resolve(String(args.get('--samples-dir') || path.join(root, 'test-results/pronounce-local-samples')));
  const manifestPath = path.resolve(String(args.get('--manifest') || path.join(root, 'scripts/data/segmentation-study-v1.json')));
  const samples = readHistoricalSamples(samplesDir);
  const manifest = loadManifest(manifestPath);
  const summary = {
    studyVersion: STUDY_VERSION,
    manifestEntries: manifest.length,
    historicalSamples: samples.length,
    hashes: samples.map((sample) => ({ sampleId: sample.sampleId, sourceHash: sample.sourceHash }))
  };
  if (!args.get('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2));
    return summary;
  }
  const result = await applySeed({ samples, manifest });
  console.log(JSON.stringify({ mode: 'apply', ...summary, ...result }, null, 2));
  return { ...summary, ...result };
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });

module.exports = {
  AUDIO_HASH_COLLECTION,
  HISTORICAL_IDS,
  buildAudioHashDocument,
  buildCorpusDocument,
  buildTaskDocument,
  loadManifest,
  parseArgs,
  readHistoricalSamples
};
