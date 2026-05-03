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
  src.includes('const requestedAttemptId = cleanString(req.body?.attemptId, 128)'),
  'prepare endpoint should accept optional attemptId'
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
