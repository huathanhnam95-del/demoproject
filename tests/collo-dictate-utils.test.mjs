/**
 * Test Suite for Collo-dictate hashing/normalization
 * Run with: node tests/collo-dictate-utils.test.mjs
 */

import assert from 'node:assert/strict';
import {
  countNormalizedWords,
  fnv1a32Hex,
  getColloAudioKey,
  normalizeForCompare
} from '../public/js/collo-dictate-utils.js';

function fnv1a32HexRef(text) {
  let hash = 0x811c9dc5n;
  const prime = 0x01000193n;
  const mod = 0x100000000n;
  const s = String(text ?? '');

  for (let i = 0; i < s.length; i += 1) {
    hash ^= BigInt(s.charCodeAt(i));
    hash = (hash * prime) % mod;
  }

  return hash.toString(16).padStart(8, '0');
}

console.log('🧪 Starting Collo-dictate utils tests...');

// Normalization matches PowerShell generator expectations.
assert.equal(normalizeForCompare(' Public  Debate! '), 'public debate');
assert.equal(normalizeForCompare('Don\u2019t stop'), 'dont stop'); // curly apostrophe
assert.equal(normalizeForCompare(`He said: "Hello".`), 'he said hello');
assert.equal(countNormalizedWords('public debate'), 2);
assert.equal(countNormalizedWords('  '), 0);

// FNV-1a correctness checks (reference uses BigInt).
assert.equal(fnv1a32Hex(''), '811c9dc5');
assert.equal(fnv1a32Hex('a'), 'e40c292c');
assert.equal(fnv1a32Hex('a'), fnv1a32HexRef('a'));
assert.equal(fnv1a32Hex('public debate'), fnv1a32HexRef('public debate'));

// Audio key is cd_<hash> of normalized phrase.
assert.equal(getColloAudioKey('a'), `cd_${fnv1a32HexRef('a')}`);
assert.equal(getColloAudioKey('Public debate!'), `cd_${fnv1a32HexRef('public debate')}`);

console.log('✅ Collo-dictate utils tests passed');

