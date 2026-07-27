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

function hasIndex(collectionGroup, fields) {
  return (indexes.indexes || []).some((index) =>
    index.collectionGroup === collectionGroup
    && fields.every((field) => index.fields.some((candidate) => candidate.fieldPath === field))
  );
}

assert.ok(hasIndex('essay_ai_queue', ['status', 'submittedAt']), 'essay_ai_queue status/submittedAt index is required');
assert.ok(hasIndex('essay_ai_queue', ['status', 'leaseExpiresAt']), 'essay_ai_queue status/leaseExpiresAt index is required');
assert.ok(hasIndex('user_notifications', ['uid', 'isRead', 'createdAt']), 'user_notifications owner/unread/createdAt index is required');
assert.ok(hasIndex('crm_system_alerts', ['status', 'createdAt']), 'crm_system_alerts status/createdAt index is required');
assert.ok(hasIndex('essay_ai_backfill_jobs', ['status', 'createdAt']), 'backfill job status/createdAt index is required');
assert.ok(hasIndex('essay_ai_backfill_jobs', ['status', 'leaseExpiresAt']), 'backfill job status/leaseExpiresAt index is required');
assert.ok(hasIndex('speakingAttempts', ['practiceScope', 'canonicalMode', 'status', 'submittedAt']), 'essay backfill attempt index is required');
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

const pteLearnerHistoryIndex = (indexes.indexes || []).find((index) =>
  index.collectionGroup === 'speakingAttempts'
  && Array.isArray(index.fields)
  && index.fields.some((field) => field.fieldPath === 'ownerUid')
  && index.fields.some((field) => field.fieldPath === 'status')
  && index.fields.some((field) => field.fieldPath === 'practiceScope')
  && index.fields.some((field) => field.fieldPath === 'createdAt' && field.order === 'DESCENDING')
);

assert.ok(
  pteLearnerHistoryIndex,
  'firestore.indexes.json should define the learner PTE history index for ownerUid/status/practiceScope/createdAt'
);

console.log('Phase 3 Firestore indexes test passed.');
