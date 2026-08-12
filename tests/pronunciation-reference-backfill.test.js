const assert = require('assert');
const {
  parseArgs,
  parseOxfordWords,
  referenceNeedsRefresh
} = require('../scripts/audit/pronunciation_reference_backfill_core');

assert.deepEqual(parseOxfordWords('"word","form","level"\n"perfect","adj.","B1"\n"perfect","v.","B2"\n"contract","n.","B2"\n'), ['perfect', 'contract']);
assert.equal(parseArgs(['--apply', '--limit', '25']).apply, true);
assert.equal(parseArgs(['--apply', '--limit', '25']).limit, 25);
assert.equal(referenceNeedsRefresh({ audioUrl: 'x', nativeAnalysis: null }), true);
assert.equal(referenceNeedsRefresh({
  audioUrl: 'x',
  nativeAnalysis: {
    pitchProcessing: { version: 'canonical-pitch-v1' },
    audioCompatibility: { version: 'reference-audio-compatibility-v1' }
  }
}), false);

console.log('pronunciation reference backfill tests passed');
