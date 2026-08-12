const assert = require('assert');

const {
  COLLECTION,
  buildReferenceAudioKey,
  buildWaitingRecord,
  resolveDiscoveryReason,
  upsertReferenceAudioNeed
} = require('../../functions/src/pronunciation-reference-audio/service');

const adjective = {
  id: '23212949e88a26e3',
  partOfSpeech: 'adjective',
  displayIpa: '/ˈpərfɪkt/',
  syllableCount: 2,
  primaryStress: 0,
  secondaryStress: [],
  syllables: [{ index: 0, ipa: 'pər' }, { index: 1, ipa: 'fɪkt' }],
  audioUrl: null
};
const reference = {
  word: 'perfect',
  algorithmVersion: 'pronunciation-reference-v4',
  variants: [adjective]
};

const key = buildReferenceAudioKey(reference, adjective);
assert.match(key, /^[a-f0-9]{40}$/);
assert.equal(key, buildReferenceAudioKey(reference, { ...adjective }));
assert.notEqual(key, buildReferenceAudioKey(reference, { ...adjective, id: 'c2c0d94fb4bf1723', partOfSpeech: 'verb', primaryStress: 1 }));

assert.equal(resolveDiscoveryReason(reference, adjective, null), 'missing_source_audio');
const sharedUrl = 'https://media.merriam-webster.com/contract.mp3';
const noun = { ...adjective, id: '1111111111111111', partOfSpeech: 'noun', displayIpa: '/ˈkɑntrækt/', primaryStress: 0, audioUrl: sharedUrl };
const verb = { ...adjective, id: '2222222222222222', partOfSpeech: 'verb', displayIpa: '/kənˈtrækt/', primaryStress: 1, audioUrl: sharedUrl };
assert.equal(resolveDiscoveryReason({ ...reference, variants: [noun, verb] }, verb, null), 'source_variant_conflict');
assert.equal(resolveDiscoveryReason({ ...reference, variants: [{ ...adjective, audioUrl: sharedUrl }] }, { ...adjective, audioUrl: sharedUrl }, {
  audioCompatibility: { status: 'unrateable' },
  pitchProcessing: { status: 'unrateable' }
}), 'acoustic_unrateable');
assert.equal(resolveDiscoveryReason({ ...reference, variants: [{ ...adjective, audioUrl: sharedUrl }] }, { ...adjective, audioUrl: sharedUrl }, {
  audioCompatibility: { status: 'compatible' },
  pitchProcessing: { status: 'clean' }
}), null);

const now = new Date('2026-08-12T08:00:00.000Z');
const waiting = buildWaitingRecord(reference, adjective, 'missing_source_audio', now);
assert.equal(waiting.referenceAudioKey, key);
assert.equal(waiting.word, 'perfect');
assert.equal(waiting.partOfSpeech, 'adjective');
assert.equal(waiting.generationStatus, 'waiting');
assert.equal(waiting.verificationStatus, 'pending');
assert.equal(waiting.lookupCount, 1);
assert.deepEqual(waiting.syllables, adjective.syllables);

function fakeDb(existing = null) {
  let stored = existing;
  return {
    collection(name) {
      assert.equal(name, COLLECTION);
      return { doc(id) { return { id }; } };
    },
    async runTransaction(handler) {
      return handler({
        async get(ref) { return { exists: Boolean(stored), data: () => stored }; },
        set(ref, value) { stored = value; }
      });
    },
    read() { return stored; }
  };
}

(async () => {
  const db = fakeDb();
  await upsertReferenceAudioNeed({ db, reference, variant: adjective, reason: 'missing_source_audio', now });
  const firstSeenAt = db.read().firstSeenAt;
  await upsertReferenceAudioNeed({ db, reference, variant: adjective, reason: 'missing_source_audio', now: new Date(now.getTime() + 1000) });
  assert.equal(db.read().lookupCount, 2);
  assert.equal(db.read().firstSeenAt, firstSeenAt);
  assert.equal(db.read().generationStatus, 'waiting');
  console.log('pronunciation reference audio service tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
