const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting practice attempts Storage rules contract test...');

const rulesPath = path.join(process.cwd(), 'storage.rules');
assert.ok(fs.existsSync(rulesPath), 'storage.rules should exist');

const rules = fs.readFileSync(rulesPath, 'utf8');

// Legacy attempt audio upload contract (server writes studentPath = practice-attempts/{uid}/{attemptId}/student.wav).
assert.ok(
  rules.includes('match /practice-attempts/{uid}/{attemptId}/student.wav'),
  'storage.rules should keep legacy writes for practice-attempts/{uid}/{attemptId}/student.wav'
);
assert.ok(
  rules.includes("speakingAttemptData(attemptId).status == 'awaiting_upload'"),
  'attempt uploads should require awaiting_upload status in speakingAttempts doc'
);
assert.ok(
  rules.includes("speakingAttemptData(attemptId).audio.studentPath == ('practice-attempts/' + uid + '/' + attemptId + '/student.wav')"),
  'attempt uploads should require storage path to match attempt audio.studentPath'
);
assert.ok(
  rules.includes('match /practice-attempts/{uid}/{attemptId}/{slotFile}'),
  'storage.rules should allow slot-based PTE archive media writes'
);
assert.ok(
  rules.includes('isAllowedAttemptMediaUpload(50 * 1024 * 1024)'),
  'slot-based attempt uploads should allow bounded WAV/WebM media'
);
assert.ok(
  rules.includes("speakingAttemptData(attemptId).mediaSlots[slotFile].storagePath == ('practice-attempts/' + uid + '/' + attemptId + '/' + slotFile)"),
  'slot-based uploads should require the path to match the prepared media slot'
);
assert.ok(
  rules.includes("speakingAttemptData(attemptId).mediaSlots[slotFile].status == 'awaiting_upload'"),
  'slot-based uploads should require awaiting_upload status for that slot'
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
