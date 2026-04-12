const assert = require('assert');
/* eslint-disable no-console */

console.log('Starting practice attempts constraints contract test...');

const {
  getModeConstraints
} = require('../functions/src/practice-attempts/attempt-constraints');

const readAloud = getModeConstraints('read_aloud');
assert.ok(readAloud, 'read_aloud constraints should resolve');
assert.strictEqual(readAloud.hardMaxSeconds, 40, 'read_aloud hard max should be 40s');
assert.strictEqual(readAloud.uiMaxSeconds, 40, 'read_aloud ui max should be 40s');

const repeatSentence = getModeConstraints('repeat_sentence');
assert.ok(repeatSentence, 'repeat_sentence constraints should resolve');
assert.strictEqual(repeatSentence.hardMaxSeconds, 15, 'repeat_sentence hard max should be 15s');
assert.strictEqual(repeatSentence.uiMaxSeconds, 15, 'repeat_sentence ui max should be 15s');

const retellLecture = getModeConstraints('retell_lecture');
assert.ok(retellLecture, 'retell_lecture constraints should resolve');
assert.strictEqual(retellLecture.hardMaxSeconds, 45, 'retell_lecture hard max should be 45s');
assert.strictEqual(retellLecture.uiMaxSeconds, 40, 'retell_lecture ui max should display as 40s');

const unknownMode = getModeConstraints('future_mode_x');
assert.ok(unknownMode, 'unknown mode constraints should fall back to defaults');
assert.strictEqual(unknownMode.hardMaxSeconds, 60, 'unknown mode hard max should be 60s');
assert.strictEqual(unknownMode.uiMaxSeconds, 60, 'unknown mode ui max should be 60s');

console.log('Practice attempts constraints contract test passed.');
