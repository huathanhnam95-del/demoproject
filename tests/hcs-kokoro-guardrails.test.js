/* eslint-disable no-console */

const assert = require('assert');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const scriptPath = path.join(rootDir, 'scripts', 'kokoro', 'kokoro_batch_hcs.js');
const { selectVoicesForQuestion, shouldFailGenerationRun } = require(scriptPath);

assert.equal(typeof selectVoicesForQuestion, 'function', 'Expected voice selector to be inspectable');
assert.equal(typeof shouldFailGenerationRun, 'function', 'Expected failed audio batches to have an explicit failure predicate');

const voices = selectVoicesForQuestion('1');
assert.equal(voices.length, 3, 'HCS should select 3 voices per question');
assert.equal(new Set(voices.map((voice) => voice.id)).size, 3, 'HCS voices should be unique per question');

assert.equal(shouldFailGenerationRun({ failed: 0 }), false, 'A clean run should not fail');
assert.equal(shouldFailGenerationRun({ failed: 1 }), true, 'Any failed audio file should fail the batch run');
