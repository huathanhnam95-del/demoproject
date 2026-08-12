const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  buildGeneratedAudioPatch,
  buildGenerationFailurePatch,
  confirmUploadedAudio,
  validateGenerationMetadata
} = require('../../functions/src/routes/admin/pronunciation-reference-audio');

const metadata = validateGenerationMetadata({
  schemaVersion: 'pronunciation-reference-audio-generation-v1',
  referenceAudioKey: 'a'.repeat(40),
  variantId: '23212949e88a26e3',
  voice: 'af_heart',
  modelRevision: 'c84adf3',
  generatorRevision: 'generator-sha',
  controlledPhonemes: 'ˈpɚfɪkt',
  durationMs: 810
});
assert.equal(metadata.voice, 'af_heart');
assert.throws(() => validateGenerationMetadata({ ...metadata, voice: 'af_bella' }), /af_heart/i);

const bytes = Buffer.from('ID3fixture-audio');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const passed = buildGeneratedAudioPatch({
  metadata,
  bytes,
  storagePath: `pronunciation-reference-audio/v1/${metadata.referenceAudioKey}/${sha256}.mp3`,
  verification: {
    variantId: metadata.variantId,
    pitchProcessing: { version: 'canonical-pitch-v1', status: 'clean' },
    audioCompatibility: { version: 'reference-audio-compatibility-v1', status: 'compatible', confidence: 0.82 }
  },
  now: new Date('2026-08-12T09:00:00Z')
});
assert.equal(passed.generationStatus, 'generated');
assert.equal(passed.verificationStatus, 'passed');
assert.equal(passed.generatedAudio.sha256, sha256);
assert.equal(passed.generatedAudio.storagePath, `pronunciation-reference-audio/v1/${metadata.referenceAudioKey}/${sha256}.mp3`);
assert.equal(passed.referenceAnalysis.graphSource.kind, 'measured-generated');
assert.equal(passed.referenceAnalysis.audioCompatibility.status, 'compatible');

assert.throws(() => buildGeneratedAudioPatch({
  metadata,
  bytes,
  storagePath: 'wrong/path.mp3',
  verification: { variantId: metadata.variantId, audioCompatibility: { status: 'compatible' }, pitchProcessing: { version: 'canonical-pitch-v1' } }
}), /storage path/i);
assert.throws(() => buildGeneratedAudioPatch({
  metadata,
  bytes,
  storagePath: `pronunciation-reference-audio/v1/${metadata.referenceAudioKey}/${sha256}.mp3`,
  verification: { variantId: metadata.variantId, audioCompatibility: { version: 'reference-audio-compatibility-v1', status: 'conflict' }, pitchProcessing: { version: 'canonical-pitch-v1' } }
}), /not compatible/i);

const failed = buildGenerationFailurePatch('REFERENCE_STRESS_CONFLICT', new Date('2026-08-12T09:01:00Z'));
assert.equal(failed.generationStatus, 'waiting');
assert.equal(failed.verificationStatus, 'failed');
assert.equal(failed.lastError, 'REFERENCE_STRESS_CONFLICT');
assert.equal(confirmUploadedAudio(bytes, Buffer.from(bytes)), sha256);
assert.throws(() => confirmUploadedAudio(bytes, Buffer.from('ID3different')), /hash confirmation/i);

const root = path.resolve(__dirname, '..', '..');
const firestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
assert.match(firestoreRules, /match \/pronunciationReferenceAudio\/\{referenceAudioKey\}[\s\S]*allow write: if false/);
assert.match(storageRules, /match \/pronunciation-reference-audio\/\{allPaths=\*\*\}[\s\S]*allow read, write: if false/);

console.log('pronunciation reference audio admin tests passed');
