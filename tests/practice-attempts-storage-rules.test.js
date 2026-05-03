const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting practice attempts Storage rules contract test...');

const rulesPath = path.join(process.cwd(), 'storage.rules');
assert.ok(fs.existsSync(rulesPath), 'storage.rules should exist');

const rules = fs.readFileSync(rulesPath, 'utf8');

// Attempt audio upload contract (server writes studentPath = practice-attempts/{uid}/{attemptId}/student.wav).
assert.ok(
  rules.includes('match /practice-attempts/{uid}/{attemptId}/student.wav'),
  'storage.rules should allow writes for practice-attempts/{uid}/{attemptId}/student.wav'
);
assert.ok(
  rules.includes("speakingAttemptData(attemptId).status == 'awaiting_upload'"),
  'attempt uploads should require awaiting_upload status in speakingAttempts doc'
);
assert.ok(
  rules.includes("speakingAttemptData(attemptId).audio.studentPath == ('practice-attempts/' + uid + '/' + attemptId + '/student.wav')"),
  'attempt uploads should require storage path to match attempt audio.studentPath'
);

// Feedback audio upload contract (server writes audioPath = practice-attempt-feedback/{attemptId}/{feedbackId}/{uid}.wav).
assert.ok(
  rules.includes('match /practice-attempt-feedback/{attemptId}/{feedbackId}/{filename}'),
  'storage.rules should include a match for practice-attempt-feedback/{attemptId}/{feedbackId}/{filename}'
);
assert.ok(
  rules.includes("filename == (request.auth.uid + '.wav')"),
  'storage.rules should require feedback filename to be {uid}.wav'
);
assert.ok(
  rules.includes("feedbackData(attemptId, feedbackId).status == 'awaiting_upload'"),
  'feedback uploads should require awaiting_upload status in feedback doc'
);
assert.ok(
  rules.includes("feedbackData(attemptId, feedbackId).audioPath == ('practice-attempt-feedback/' + attemptId + '/' + feedbackId + '/' + request.auth.uid + '.wav')"),
  'feedback uploads should require storage path to match feedback audioPath'
);

console.log('Practice attempts Storage rules contract test passed.');
