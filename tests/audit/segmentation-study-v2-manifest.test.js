/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STUDIES, syncManifest, validateManifest } = require('../../scripts/segmentation-study/sync-manifest');
const { applySeed, buildTaskDocument, dryRunSeed, main, readManifest, summary } = require('../../scripts/segmentation-study/seed-study');

const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'scripts/data/segmentation-study-v2.json');
const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
const validated = validateManifest(manifest, 'v2');
assert.strictEqual(validated.studyId, 'segmentation-study-v2');
assert.strictEqual(manifest.entries.length, 100);
assert.deepStrictEqual(manifest.entries.reduce((counts, entry) => { counts[entry.targetSyllableCount] += 1; return counts; }, { 2: 0, 3: 0, 4: 0, 5: 0 }), { 2: 25, 3: 25, 4: 25, 5: 25 });
assert.strictEqual(manifest.entries.filter((entry) => entry.split === 'development').length, 70);
assert.strictEqual(manifest.entries.filter((entry) => entry.split === 'holdout').length, 30);
assert.strictEqual(manifest.entries.every((entry) => entry.referenceLabelProvenance === 'explicit-reviewed-en-US-v1'), true);
assert.strictEqual(readManifest(source, 'v2').manifestSha256, manifest.manifestSha256);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-v2-manifest-'));
const destination = path.join(tempDir, 'segmentation-study-v2.json');
const synced = syncManifest({ studyVersion: 'v2', destinationPath: destination });
assert.strictEqual(synced.studyId, 'segmentation-study-v2');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), manifest);
assert.strictEqual(STUDIES.v1.studyId, 'segmentation-study-v1');

const task = buildTaskDocument(manifest.entries[0], new Date('2026-08-19T00:00:00Z'), manifest);
assert.strictEqual(task.studyVersion, 'study-v2');
assert.strictEqual(task.speakerCohort, manifest.studyId);
assert.strictEqual(task.manifestSource, 'scripts/data/segmentation-study-v2.json');
assert.strictEqual(task.studyId, manifest.studyId);
assert.strictEqual(task.manifestVersion, manifest.version);
assert.strictEqual(task.manifestSha256, manifest.manifestSha256);
assert.strictEqual(task.referenceLabelProvenance, 'explicit-reviewed-en-US-v1');
assert.deepStrictEqual(task.referenceProvenance, manifest.entries[0].referenceProvenance);
assert.deepStrictEqual(task.transitionFamilies, manifest.entries[0].transitionFamilies);
assert.strictEqual(summary(manifest, 'dry-run').destructiveOperations, 0);
const fakeDb = {
  collection(collectionName) {
    assert.strictEqual(collectionName, 'pronunciationSegmentationStudyTasks');
    return {
      doc(taskId) {
        return {
          async get() {
            return { exists: taskId === manifest.entries[0].taskId };
          },
          async create() {
            throw new Error('dry-run must not write');
          }
        };
      }
    };
  }
};
const fakeAdmin = {
  apps: [],
  credential: {
    applicationDefault() {
      fakeAdmin.credentialCalls = (fakeAdmin.credentialCalls || 0) + 1;
      return { type: 'application-default' };
    }
  },
  initializeApp(options) {
    assert.deepStrictEqual(options, { credential: { type: 'application-default' } });
    fakeAdmin.initializeCalls = (fakeAdmin.initializeCalls || 0) + 1;
    fakeAdmin.apps.push({});
  },
  firestore() {
    fakeAdmin.firestoreCalls = (fakeAdmin.firestoreCalls || 0) + 1;
    return fakeDb;
  }
};

const applyManifest = { ...manifest, entries: manifest.entries.slice(0, 3) };
const raceCreateCalls = [];
const raceDb = {
  collection() {
    return {
      doc(taskId) {
        return {
          async get() {
            return { exists: false };
          },
          async create() {
            raceCreateCalls.push(taskId);
            if (taskId === applyManifest.entries[0].taskId) throw { code: 6 };
            if (taskId === applyManifest.entries[1].taskId) throw { code: '6' };
          }
        };
      }
    };
  }
};
const nonRaceError = { code: 'PERMISSION_DENIED' };
const nonRaceDb = {
  collection() {
    return {
      doc() {
        return {
          async get() {
            return { exists: false };
          },
          async create() {
            throw nonRaceError;
          }
        };
      }
    };
  }
};

Promise.all([
  dryRunSeed(manifest).then((result) => {
    assert.strictEqual(result.creates, 100);
    assert.strictEqual(result.existing, 0);
    assert.strictEqual(result.writes, 0);
  }),
  main(['--study-version', 'v2'], { firebaseAdmin: fakeAdmin }).then((result) => {
    assert.strictEqual(result.mode, 'dry-run');
    assert.strictEqual(result.creates, 99);
    assert.strictEqual(result.existing, 1);
    assert.strictEqual(result.writes, 0);
    assert.strictEqual(fakeAdmin.credentialCalls, 1);
    assert.strictEqual(fakeAdmin.initializeCalls, 1);
    assert.strictEqual(fakeAdmin.firestoreCalls, 1);
  }),
  applySeed(applyManifest, { db: raceDb, timestamp: new Date('2026-08-23T00:00:00Z') }).then((result) => {
    assert.deepStrictEqual(result, { created: 1, existing: 2, deleted: 0 });
    assert.deepStrictEqual(raceCreateCalls, applyManifest.entries.map((entry) => entry.taskId));
  }),
  applySeed({ ...manifest, entries: [manifest.entries[0]] }, { db: nonRaceDb }).then(() => {
    throw new Error('non-ALREADY_EXISTS errors must be rethrown');
  }, (error) => {
    assert.strictEqual(error, nonRaceError);
  })
]).then(() => {
  console.log('segmentation study-v2 manifest, bundle sync, and dry-run seed contracts passed');
}).catch((error) => { console.error(error); process.exitCode = 1; });
