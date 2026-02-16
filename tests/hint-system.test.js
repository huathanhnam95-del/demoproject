/**
 * Test Suite for HintSystem ladder (economy-agnostic)
 * Run with: node tests/hint-system.test.js
 */

const assert = require('assert');

global.window = {};

require('../public/hint-system.js');

const HintSystem = global.window.HintSystem;
assert.ok(HintSystem, 'HintSystem should attach to window');

console.log('🧪 Starting HintSystem Tests...');

assert.equal(HintSystem.MAX_HINT_LEVEL, 3, 'MAX_HINT_LEVEL should be 3');

HintSystem.reset();
HintSystem.resetForNewQuestion(1, 'type');

// Prime should not exceed max
HintSystem.primeHintLevel(2);
assert.equal(HintSystem.getCurrentHintLevel(), 2);

// Use next hint (3) -> transcript glimpse
const r3 = HintSystem.useHint('Hello world');
assert.equal(r3.success, true);
assert.equal(r3.level, 3);
assert.equal(r3.hint.type, 'transcript-glimpse');
assert.equal(r3.hint.contentText, 'Hello world');
assert.ok(Number.isFinite(r3.hint.transientMs) && r3.hint.transientMs > 0, 'transientMs should be > 0');
assert.equal(r3.hasMore, false);

// No more hints
const r4 = HintSystem.useHint('Hello world');
assert.equal(r4.success, false);
assert.equal(r4.maxReached, true);

console.log('✅ HintSystem tests passed');

