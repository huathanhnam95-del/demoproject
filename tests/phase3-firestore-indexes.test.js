const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting Phase 3 Firestore indexes test...');

const firebaseConfigPath = path.join(process.cwd(), 'firebase.json');
const indexesPath = path.join(process.cwd(), 'firestore.indexes.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

assert.strictEqual(
  firebaseConfig.firestore.indexes,
  'firestore.indexes.json',
  'firebase.json should publish the Firestore index definitions file'
);

assert.ok(
  fs.existsSync(indexesPath),
  'firestore.indexes.json should exist for the background jobs queue composite index'
);

const indexes = JSON.parse(fs.readFileSync(indexesPath, 'utf8'));
const jobsIndex = (indexes.indexes || []).find((index) =>
  index.collectionGroup === 'jobs'
  && Array.isArray(index.fields)
  && index.fields.some((field) => field.fieldPath === 'status')
  && index.fields.some((field) => field.fieldPath === 'type')
  && index.fields.some((field) => field.fieldPath === 'createdAt')
);

assert.ok(
  jobsIndex,
  'firestore.indexes.json should define the jobs status/type/createdAt composite index used by queue-service.claimNextJob'
);

const pteReviewIndex = (indexes.indexes || []).find((index) =>
  index.collectionGroup === 'speakingAttempts'
  && Array.isArray(index.fields)
  && index.fields.some((field) => field.fieldPath === 'practiceScope')
  && index.fields.some((field) => field.fieldPath === 'crmStudentId')
  && index.fields.some((field) => field.fieldPath === 'submittedAt')
);

assert.ok(
  pteReviewIndex,
  'firestore.indexes.json should define the PTE attempt review index for practiceScope/crmStudentId/submittedAt'
);

console.log('Phase 3 Firestore indexes test passed.');
