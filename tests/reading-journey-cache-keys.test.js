/**
 * Reading Journey cache key tests
 * Run with: node tests/reading-journey-cache-keys.test.js
 */

const assert = require('assert');
const Cache = require('../src/services/reading-journey/cache');

console.log('Starting Reading Journey cache key tests...');

// normalizeKeywords
assert.deepStrictEqual(
  Cache.normalizeKeywords([' Ocean ', 'mystery', 'ocean', '', '  ']),
  ['mystery', 'ocean'],
  'normalizeKeywords should trim, lowercase, dedupe, and sort'
);

// computeOutlineCacheKey normalization
const outlineA = Cache.computeOutlineCacheKey({
  language: 'en',
  level: 'B1',
  topicTags: ['Mystery', 'friendship', ' Nature ']
});
const outlineB = Cache.computeOutlineCacheKey({
  language: 'en',
  level: 'B1',
  topicTags: ['nature', 'mystery', 'FriendShip']
});
assert.strictEqual(outlineA.id, outlineB.id, 'Outline cache id should be stable across tag order/case');
assert.strictEqual(outlineA.key, outlineB.key, 'Outline cache key string should be stable across tag order/case');

// computeBeatCacheKey path changes
const beat1 = Cache.computeBeatCacheKey({ outlineId: outlineA.id, beatNumber: 2, path: ['inspect_object'] });
const beat2 = Cache.computeBeatCacheKey({ outlineId: outlineA.id, beatNumber: 2, path: ['ask_friend'] });
assert.notStrictEqual(beat1.id, beat2.id, 'Beat cache id should differ when path differs');

console.log('All Reading Journey cache key tests passed.');

