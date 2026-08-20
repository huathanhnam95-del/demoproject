/* eslint-disable no-console */
// Idempotent task seeding for an explicitly selected segmentation study.
// Dry-run is the default. Apply only from an authenticated ADC checkout; this
// script creates only missing selected-study tasks and never deletes or
// rewrites another study version.

const fs = require('fs');
const path = require('path');
const { studyConfig, validateManifest } = require('./sync-manifest');

const TASK_COLLECTION = 'pronunciationSegmentationStudyTasks';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    args[key] = value && !value.startsWith('--') ? value : true;
    if (args[key] !== true) index += 1;
  }
  return args;
}

function readManifest(manifestPath, studyVersion = 'v2') {
  const config = studyConfig(studyVersion);
  const parsed = JSON.parse(fs.readFileSync(path.resolve(manifestPath || config.sourcePath), 'utf8'));
  validateManifest(parsed, studyVersion);
  return parsed;
}

function buildTaskDocument(entry, timestamp = new Date(), manifest = null) {
  const isV2 = entry.taskId.startsWith('segmentation-study-v2-');
  return {
    studyId: manifest?.studyId || (isV2 ? 'segmentation-study-v2' : 'segmentation-study-v1'),
    studyVersion: isV2 ? 'study-v2' : 'study-v1',
    speakerCohort: manifest?.studyId || (isV2 ? 'segmentation-study-v2' : 'segmentation-study-v1'),
    taskId: entry.taskId,
    order: entry.order,
    split: entry.split,
    targetWord: entry.targetWord,
    referenceIpa: entry.referenceIpa,
    referenceSyllableIpa: entry.referenceSyllableIpa,
    targetSyllableCount: entry.targetSyllableCount,
    expectedObservedCount: entry.expectedObservedCount || entry.targetSyllableCount,
    transitionClasses: entry.transitionTypes || [],
    transitionTypes: entry.transitionTypes || [],
    transitionFamilies: entry.transitionFamilies || [],
    referenceDialect: entry.referenceDialect || entry.dialect || null,
    dialect: entry.dialect || entry.referenceDialect || null,
    referenceSource: entry.referenceSource || entry.ipaSource || null,
    referenceProvenance: entry.referenceProvenance || null,
    referenceLabelProvenance: entry.referenceLabelProvenance || null,
    exceptionRationale: entry.exceptionRationale || null,
    manifestVersion: manifest?.version || null,
    manifestSha256: manifest?.manifestSha256 || null,
    manifestSource: isV2 ? 'scripts/data/segmentation-study-v2.json' : 'scripts/data/segmentation-study-v1.json',
    status: 'available',
    claim: null,
    claimExpiresAt: null,
    completedSampleId: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function applySeed(manifest, { db, timestamp = new Date() } = {}) {
  if (!db) throw new Error('An ADC-backed Firestore db is required for --apply.');
  let created = 0;
  let existing = 0;
  for (const entry of manifest.entries) {
    const ref = db.collection(TASK_COLLECTION).doc(entry.taskId);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      existing += 1;
      continue;
    }
    await ref.create(buildTaskDocument(entry, timestamp, manifest));
    created += 1;
  }
  return { created, existing, deleted: 0 };
}

async function dryRunSeed(manifest, { db } = {}) {
  let creates = manifest.entries.length;
  let existing = 0;
  if (db) {
    creates = 0;
    for (const entry of manifest.entries) {
      const snapshot = await db.collection(TASK_COLLECTION).doc(entry.taskId).get();
      if (snapshot.exists) existing += 1;
      else creates += 1;
    }
  }
  return { creates, existing, deleted: 0, writes: 0 };
}

function summary(manifest, mode) {
  return {
    mode,
    studyId: manifest.studyId,
    studyVersion: manifest.studyId.replace('segmentation-', ''),
    manifestVersion: manifest.version,
    manifestSha256: manifest.manifestSha256,
    entries: manifest.entries.length,
    destructiveOperations: 0
  };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const studyVersion = args['study-version'] || 'v2';
  const manifest = readManifest(args.manifest, studyVersion);
  if (!args.apply) {
    const result = { ...summary(manifest, 'dry-run'), ...(await dryRunSeed(manifest, { db: dependencies.db })) };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const db = dependencies.db || (() => {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
  })();
  const result = { ...summary(manifest, 'apply'), ...(await applySeed(manifest, { db })) };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });

module.exports = { TASK_COLLECTION, applySeed, buildTaskDocument, dryRunSeed, main, parseArgs, readManifest, summary };
