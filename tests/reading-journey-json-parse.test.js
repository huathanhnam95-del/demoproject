/**
 * Reading Journey JSON parsing tests
 * Run with: node tests/reading-journey-json-parse.test.js
 */

const assert = require('assert');
const RJJson = require('../src/services/reading-journey/json');

console.log('Starting Reading Journey JSON parsing tests...');

const wrapped = 'Here you go:\\n```json\\n{ \"a\": 1, \"b\": [2,3] }\\n```\\nThanks!';
const parsed = RJJson.safeJsonParse(wrapped);
assert.deepStrictEqual(parsed, { a: 1, b: [2, 3] }, 'safeJsonParse should extract and parse JSON object');

assert.strictEqual(RJJson.countWords('Hello   world\nthis is\t ok'), 5, 'countWords should count tokens');

const longText = 'One two three. Four five six seven eight nine ten.';
const trimmed = RJJson.trimToMaxWords(longText, 4);
assert.strictEqual(RJJson.countWords(trimmed) <= 4, true, 'trimToMaxWords should enforce max words');

console.log('All Reading Journey JSON parsing tests passed.');
