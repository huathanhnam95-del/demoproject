const assert = require('assert');

const {
  reportReferenceAudioNeed,
  resolveGeneratedReferenceAudio
} = require('../../functions/src/routes/pronunciation-reference-audio');

function fakeDb() {
  let stored = null;
  return {
    collection() { return { doc(id) { return { id }; } }; },
    async runTransaction(handler) {
      return handler({
        async get() { return { exists: Boolean(stored), data: () => stored }; },
        set(ref, value) { stored = value; }
      });
    },
    read: () => stored
  };
}

const reference = {
  algorithmVersion: 'pronunciation-reference-v4',
  word: 'perfect',
  variants: [{
    id: '23212949e88a26e3',
    partOfSpeech: 'adjective',
    displayIpa: '/ˈpərfɪkt/',
    syllableCount: 2,
    primaryStress: 0,
    secondaryStress: [],
    syllables: [{ index: 0, ipa: 'pər' }, { index: 1, ipa: 'fɪkt' }],
    audioUrl: null
  }]
};

(async () => {
  const db = fakeDb();
  const result = await reportReferenceAudioNeed({
    db,
    word: ' Perfect ',
    variantId: '23212949e88a26e3',
    fetchReference: async (word) => {
      assert.equal(word, 'perfect');
      return reference;
    },
    analyzeVariant: async () => { throw new Error('missing audio must not be analyzed'); },
    now: new Date('2026-08-12T08:00:00Z')
  });
  assert.equal(result.queued, true);
  assert.equal(result.record.discoveryReason, 'missing_source_audio');
  assert.equal(db.read().displayIpa, '/ˈpərfɪkt/');

  await assert.rejects(() => reportReferenceAudioNeed({
    db,
    word: 'perfect',
    variantId: 'ffffffffffffffff',
    fetchReference: async () => reference,
    analyzeVariant: async () => null
  }), /variant not found/i);

  const withAudio = {
    ...reference,
    variants: [{ ...reference.variants[0], audioUrl: 'https://media.merriam-webster.com/perfect.mp3' }]
  };
  const compatible = await reportReferenceAudioNeed({
    db: fakeDb(),
    word: 'perfect',
    variantId: '23212949e88a26e3',
    fetchReference: async () => withAudio,
    analyzeVariant: async (variant) => {
      assert.equal(variant.displayIpa, '/ˈpərfɪkt/');
      return { audioCompatibility: { status: 'compatible' }, pitchProcessing: { status: 'clean' } };
    }
  });
  assert.deepEqual(compatible, { queued: false, reason: null });

  const sharedReference = {
    ...withAudio,
    variants: [
      withAudio.variants[0],
      { ...withAudio.variants[0], id: '1111111111111111', partOfSpeech: 'verb', primaryStress: 1 }
    ]
  };
  let sharedAnalyzed = false;
  const sharedCompatible = await reportReferenceAudioNeed({
    db: fakeDb(), word: 'perfect', variantId: '23212949e88a26e3', fetchReference: async () => sharedReference,
    analyzeVariant: async () => { sharedAnalyzed = true; return { audioCompatibility: { status: 'compatible' }, pitchProcessing: { status: 'clean' } }; }
  });
  assert.equal(sharedAnalyzed, true);
  assert.equal(sharedCompatible.queued, false);

  const generatedDb = fakeDb();
  await reportReferenceAudioNeed({
    db: generatedDb,
    word: 'perfect',
    variantId: '23212949e88a26e3',
    fetchReference: async () => reference,
    analyzeVariant: async () => null
  });
  const generatedRecord = generatedDb.read();
  generatedRecord.generationStatus = 'generated';
  generatedRecord.verificationStatus = 'passed';
  generatedRecord.generatedAudio = { storagePath: `pronunciation-reference-audio/v1/${generatedRecord.referenceAudioKey}/asset.mp3`, sha256: 'b'.repeat(64) };
  generatedRecord.referenceAnalysis = { graphSource: { kind: 'measured-generated' }, capabilities: { showNativeGraphs: true } };
  const resolved = await resolveGeneratedReferenceAudio({
    db: generatedDb,
    word: 'perfect',
    variantId: '23212949e88a26e3',
    fetchReference: async () => reference
  });
  assert.equal(resolved.available, true);
  assert.equal(resolved.generatedAudio.sourceKind, 'generated');
  assert.match(resolved.generatedAudio.url, new RegExp(generatedRecord.referenceAudioKey));
  console.log('pronunciation reference audio report tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
