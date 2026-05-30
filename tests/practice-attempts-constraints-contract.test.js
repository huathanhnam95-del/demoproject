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

const describeImage = getModeConstraints('describe-image');
assert.ok(describeImage, 'describe-image constraints should resolve');
assert.strictEqual(describeImage.practiceMode, 'describe_image', 'describe-image should normalize to describe_image');
assert.strictEqual(describeImage.hardMaxSeconds, 40, 'describe-image hard max should be 40s');

const asq = getModeConstraints('asq');
assert.ok(asq, 'asq constraints should resolve');
assert.strictEqual(asq.practiceMode, 'answer_short_question', 'asq should normalize to answer_short_question');
assert.strictEqual(asq.hardMaxSeconds, 10, 'asq hard max should be 10s');

const rts = getModeConstraints('rts');
assert.ok(rts, 'rts constraints should resolve');
assert.strictEqual(rts.practiceMode, 'respond_to_situation', 'rts should normalize to respond_to_situation');
assert.strictEqual(rts.hardMaxSeconds, 40, 'rts hard max should be 40s');

const sgd = getModeConstraints('sgd');
assert.ok(sgd, 'sgd constraints should resolve');
assert.strictEqual(sgd.practiceMode, 'summarize_group_discussion', 'sgd should normalize to summarize_group_discussion');
assert.strictEqual(sgd.hardMaxSeconds, 120, 'sgd hard max should be 120s');

const unknownMode = getModeConstraints('future_mode_x');
assert.ok(unknownMode, 'unknown mode constraints should fall back to defaults');
assert.strictEqual(unknownMode.hardMaxSeconds, 60, 'unknown mode hard max should be 60s');
assert.strictEqual(unknownMode.uiMaxSeconds, 60, 'unknown mode ui max should be 60s');

console.log('Practice attempts constraints contract test passed.');
