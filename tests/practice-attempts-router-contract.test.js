const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting practice attempts router contract test...');

const filePath = path.join(process.cwd(), 'functions', 'src', 'routes', 'practice-attempts.js');
assert.ok(fs.existsSync(filePath), 'functions/src/routes/practice-attempts.js should exist');

const src = fs.readFileSync(filePath, 'utf8');

assert.ok(
  src.includes("router.post('/prepare'"),
  'prepare endpoint should exist'
);
assert.ok(
  src.includes("router.post('/save'"),
  'save endpoint should exist for non-media and completed-media PTE archives'
);
assert.ok(
  src.includes("const ATTEMPTS_COLLECTION = 'speakingAttempts'"),
  'route should generalize attempts behind ATTEMPTS_COLLECTION while keeping legacy collection compatibility'
);
assert.ok(
  src.includes('schemaVersion: 2'),
  'new PTE archive attempts should write schemaVersion: 2'
);
assert.ok(
  src.includes("practiceScope: 'pte'"),
  'new attempt documents should persist practiceScope: pte'
);
assert.ok(
  src.includes('PTE_MODE_META'),
  'route should use a strict server-side PTE mode allowlist'
);
assert.ok(
  src.includes('INVALID_PRACTICE_SCOPE'),
  'save endpoint should reject non-PTE practice scopes'
);
assert.ok(
  src.includes('INVALID_PRACTICE_MODE'),
  'save endpoint should reject modes outside the PTE allowlist'
);
assert.ok(
  src.includes('const requestedAttemptId = cleanString(req.body?.attemptId, 128)'),
  'prepare endpoint should accept optional attemptId'
);
assert.ok(
  src.includes('sanitizeArchiveSnapshot'),
  'save endpoint should sanitize structured archive snapshots before persisting'
);
assert.ok(
  src.includes('sanitizeMediaSlots'),
  'prepare/save flow should support slot-based media manifests'
);
assert.ok(
  !src.includes('skipMediaValidation'),
  'client requests must not be able to bypass server-side media validation'
);
assert.ok(
  src.includes("req.query?.practiceScope"),
  'mine listing should support practiceScope filtering for learner PTE history'
);
assert.ok(
  src.includes('clientReportedDurationMs'),
  'WebM media should be allowed with client-reported duration metadata'
);
assert.ok(
  src.includes('MEDIA_DURATION_REQUIRED'),
  'WebM media should be rejected when client-reported duration metadata is missing'
);
assert.ok(
  src.includes('AUDIO_DURATION_EXCEEDED'),
  'complete endpoint should enforce duration limits'
);
assert.ok(
  src.includes('constraintSnapshot'),
  'attempts should persist mode constraint snapshots'
);
assert.ok(
  src.includes('SPEAKING_ATTEMPT_COUNTERS'),
  'bookmark logic should use speakingAttemptCounters collection'
);
assert.ok(
  src.includes('reviewer.allowedStudentIds'),
  'reviewer access should be scoped to authorized CRM student ids'
);
assert.ok(
  src.includes('attempt.crmStudentId'),
  'attempt authorization should compare reviewer access against attempt crmStudentId'
);
assert.ok(
  src.includes("router.get('/:attemptId/feedback'"),
  'feedback list endpoint should exist'
);
assert.ok(
  src.includes("router.patch('/:attemptId/feedback/:feedbackId'"),
  'feedback edit endpoint should exist'
);
assert.ok(
  src.includes("router.delete('/:attemptId/feedback/:feedbackId'"),
  'feedback delete endpoint should exist'
);

console.log('Practice attempts router contract test passed.');
