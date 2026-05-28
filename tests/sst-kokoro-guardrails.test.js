/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const generator = require(path.join(process.cwd(), 'scripts', 'kokoro', 'kokoro_batch_sst.js'));

const voices = generator.selectVoicesForQuestion('1');
assert.equal(voices.length, 3, 'SST should generate three voice variants per question');
assert.equal(new Set(voices.map((voice) => voice.id)).size, 3, 'SST voice variants should be unique');
assert.equal(new Set(voices.map((voice) => voice.accent)).has('British'), true, 'SST variants should include a British voice');
assert.equal(generator.shouldFailGenerationRun({ failed: 0 }), false, 'a complete Kokoro run should succeed');
assert.equal(generator.shouldFailGenerationRun({ failed: 1 }), true, 'any missing SST audio variant should fail generation');

console.log('SST Kokoro generator guardrails passed.');
