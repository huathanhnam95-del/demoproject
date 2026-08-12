const assert = require('assert');
const {
  buildControlledPhonemes,
  buildGenerationMetadata,
  parseArgs,
  selectWaitingItems
} = require('../scripts/kokoro/pronunciation_reference_audio_core');

const item = {
  referenceAudioKey: 'a'.repeat(40),
  variantId: '23212949e88a26e3',
  displayIpa: '/ˈpɚ.fɪkt/',
  generationStatus: 'waiting'
};

assert.equal(buildControlledPhonemes(item), 'ˈpɚfɪkt');
assert.throws(() => buildControlledPhonemes({ displayIpa: '' }), /IPA/i);

const options = parseArgs(['--api-base', 'http://localhost:5001', '--limit', '4', '--no-server']);
assert.equal(options.apiBase, 'http://localhost:5001');
assert.equal(options.limit, 4);
assert.equal(options.startServer, false);

const selected = selectWaitingItems([item, { ...item, referenceAudioKey: 'b'.repeat(40), generationStatus: 'generated' }], options);
assert.deepEqual(selected.map((candidate) => candidate.referenceAudioKey), [item.referenceAudioKey]);

const metadata = buildGenerationMetadata(item, {
  controlledPhonemes: 'ˈpɚfɪkt',
  durationMs: 812,
  modelRevision: 'kokoro-sha',
  generatorRevision: 'generator-sha'
});
assert.equal(metadata.schemaVersion, 'pronunciation-reference-audio-generation-v1');
assert.equal(metadata.voice, 'af_heart');
assert.equal(metadata.durationMs, 812);

console.log('pronunciation reference Kokoro generator tests passed');
