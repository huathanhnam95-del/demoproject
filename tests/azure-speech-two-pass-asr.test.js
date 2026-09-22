'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  transcribeOriginalSpeech,
  buildScoringReference,
  assessSpokenResponse
} = require('../functions/src/services/azure-speech/two-pass-asr');
const { WalletService } = require('../functions/src/ai-credits/wallet-service');
const { SettlementService } = require('../functions/src/ai-credits/settlement-service');
const { JobService } = require('../functions/src/ai-scoring/job-service');
const { ScoringWorker } = require('../functions/src/ai-scoring/worker');

class MockCollectionRef {
  constructor(basePath, storage) {
    this.basePath = basePath;
    this.storage = storage;
  }
  doc(id) {
    const docPath = `${this.basePath}/${id}`;
    return {
      path: docPath,
      collection: (subCol) => new MockCollectionRef(`${docPath}/${subCol}`, this.storage),
      get: async () => {
        const docData = this.storage.get(docPath);
        return {
          exists: docData !== undefined,
          data: () => (docData ? JSON.parse(JSON.stringify(docData)) : undefined)
        };
      },
      set: async (val) => {
        this.storage.set(docPath, JSON.parse(JSON.stringify(val)));
      },
      update: async (val) => {
        const existing = this.storage.get(docPath) || {};
        this.storage.set(docPath, { ...existing, ...JSON.parse(JSON.stringify(val)) });
      },
      delete: async () => {
        this.storage.delete(docPath);
      }
    };
  }
}

class MockDb {
  constructor() {
    this.data = new Map();
  }
  collection(name) {
    return new MockCollectionRef(name, this.data);
  }
  async runTransaction(updateFunction) {
    const tx = {
      get: async (docRef) => {
        const docData = this.data.get(docRef.path);
        return {
          exists: docData !== undefined,
          data: () => (docData ? JSON.parse(JSON.stringify(docData)) : undefined)
        };
      },
      set: (docRef, val) => {
        this.data.set(docRef.path, JSON.parse(JSON.stringify(val)));
      },
      update: (docRef, val) => {
        const existing = this.data.get(docRef.path) || {};
        this.data.set(docRef.path, { ...existing, ...JSON.parse(JSON.stringify(val)) });
      },
      delete: (docRef) => {
        this.data.delete(docRef.path);
      }
    };
    return await updateFunction(tx);
  }
}

test('transcribeOriginalSpeech: produces unconditioned verbatim transcript hypothesis', async () => {
  const dummyAudio = Buffer.alloc(32000); // 1 sec of audio

  const result = await transcribeOriginalSpeech({
    audioBuffer: dummyAudio,
    audioIdentity: { sampleRateHz: 16000, sampleCount: 16000 }
  }, { useMock: true });

  assert.ok(result.audioHash, 'should contain audio SHA-256 hash');
  assert.ok(result.rawTranscript.length > 0, 'should contain raw transcript');
  assert.ok(Array.isArray(result.tokens));
  assert.ok(result.tokens.length > 0);
  assert.ok(result.confidence > 0.5);

  const firstToken = result.tokens[0];
  assert.equal(typeof firstToken.word, 'string');
  assert.equal(typeof firstToken.startMs, 'number');
  assert.equal(typeof firstToken.endMs, 'number');
  assert.equal(typeof firstToken.confidence, 'number');
});

test('buildScoringReference: rejects empty or inaudible recordings as unrateable', () => {
  const emptyRes = buildScoringReference(null);
  assert.equal(emptyRes.status, 'unrateable');
  assert.equal(emptyRes.reason, 'NO_SPEECH_DETECTED');

  const silentRes = buildScoringReference({ rawTranscript: '', tokens: [] });
  assert.equal(silentRes.status, 'unrateable');
  assert.equal(silentRes.reason, 'NO_SPEECH_DETECTED');
});

test('buildScoringReference: flags low-confidence speech as transcript_uncertain', () => {
  const lowConfTranscription = {
    audioHash: 'hash-low',
    rawTranscript: 'muffled sound maybe',
    confidence: 0.40, // Below 0.50 threshold
    tokens: [
      { index: 0, word: 'muffled', confidence: 0.35 },
      { index: 1, word: 'sound', confidence: 0.45 },
      { index: 2, word: 'maybe', confidence: 0.40 }
    ]
  };

  const ref = buildScoringReference(lowConfTranscription);
  assert.equal(ref.status, 'transcript_uncertain');
  assert.equal(ref.reason, 'LOW_ASR_CONFIDENCE');
  assert.equal(ref.uncertainWords.length, 3);
});

test('buildScoringReference: accepts valid transcript and isolates uncertain tokens (<0.60)', () => {
  const goodTranscription = {
    audioHash: 'hash-good',
    rawTranscript: 'The climate changed rapidly in the twentieth century.',
    confidence: 0.88,
    tokens: [
      { index: 0, word: 'The', confidence: 0.95 },
      { index: 1, word: 'climate', confidence: 0.92 },
      { index: 2, word: 'changed', confidence: 0.55 }, // Uncertain (<0.60)
      { index: 3, word: 'rapidly', confidence: 0.89 },
      { index: 4, word: 'in', confidence: 0.96 },
      { index: 5, word: 'the', confidence: 0.94 },
      { index: 6, word: 'twentieth', confidence: 0.58 }, // Uncertain (<0.60)
      { index: 7, word: 'century', confidence: 0.91 }
    ]
  };

  const ref = buildScoringReference(goodTranscription);
  assert.equal(ref.status, 'accepted');
  assert.equal(ref.reason, null);
  assert.deepEqual(ref.uncertainWords, ['changed', 'twentieth']);
});

test('assessSpokenResponse: executes two-pass workflow with completenessScore: null', async () => {
  const dummyAudio = Buffer.alloc(32000);

  const result = await assessSpokenResponse({
    mode: 'retell_lecture',
    audioBuffer: dummyAudio,
    audioIdentity: { sampleRateHz: 16000, sampleCount: 16000 },
    attemptId: 'asmt-rl-test-1'
  }, { useMock: true });

  assert.equal(result.mode, 'retell_lecture');
  assert.equal(result.status, 'completed');
  // Per §9.4, completeness is null for free response
  assert.equal(result.overallScores.completenessScore, null);
  assert.equal(typeof result.overallScores.accuracyScore, 'number');
  assert.equal(typeof result.overallScores.fluencyScore, 'number');

  // Verify disclosure metadata
  assert.equal(result.transcriptDisclosure.headline, 'Pronunciation of your response');
  assert.equal(result.transcriptDisclosure.subtitle, 'Based on the words recognized in your recording. View transcript');

  // Verify word tokens have clipTiming attached
  assert.ok(result.words.length > 0);
  for (const w of result.words) {
    assert.ok(w.clipTiming);
    assert.equal(typeof w.isTranscriptUncertain, 'boolean');
  }
});

test('ScoringWorker: processes retell_lecture, summarize_group_discussion, and respond_to_a_situation out of the box', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });
  const worker = new ScoringWorker({ db, settlementService });

  const modes = ['retell_lecture', 'summarize_group_discussion', 'respond_to_a_situation'];

  for (const mode of modes) {
    const quote = await jobService.createQuote({
      uid: `learner-${mode}`,
      mode,
      inputMeta: {
        audioUrl: `https://storage.googleapis.com/test/${mode}.wav`,
        sampleCount: 32000,
        sampleRateHz: 16000,
        inputHash: `hash-${mode}`
      }
    });

    const { assessmentId } = await jobService.confirmQuote({
      uid: `learner-${mode}`,
      quoteId: quote.quoteId
    });

    const runRes = await worker.processJob(assessmentId);
    assert.equal(runRes.status, 'ready', `Worker should successfully process mode ${mode}`);

    const job = await jobService.getJobStatus(assessmentId, `learner-${mode}`);
    assert.equal(job.status, 'ready');
    assert.equal(job.result.overallScores.completenessScore, null);
  }
});

test('assessSpokenResponse: preserves word confidence and uncertainty across Pass 2 word insertions', async () => {
  const dummyAudio = Buffer.alloc(32000);
  const mockStt = {
    DisplayText: 'hello world',
    NBest: [{
      Display: 'hello world',
      Confidence: 0.9,
      Words: [
        { Word: 'hello', Offset: 1000000, Duration: 2000000, Confidence: 0.92 },
        { Word: 'world', Offset: 4000000, Duration: 3000000, Confidence: 0.55 }
      ]
    }]
  };
  const mockAzurePass2 = {
    DisplayText: 'hello beautiful world',
    NBest: [{
      AccuracyScore: 85,
      Words: [
        { Word: 'hello', Offset: 1000000, Duration: 2000000, AccuracyScore: 90 },
        { Word: 'beautiful', Offset: 3200000, Duration: 1000000, AccuracyScore: 70, ErrorType: 'Insertion' },
        { Word: 'world', Offset: 4500000, Duration: 3000000, AccuracyScore: 80 }
      ]
    }]
  };

  const res = await assessSpokenResponse({
    mode: 'retell_lecture',
    audioBuffer: dummyAudio
  }, {
    useMock: true,
    mockSttResult: mockStt,
    mockResult: mockAzurePass2
  });

  assert.equal(res.words.length, 3);
  assert.equal(res.words[0].word, 'hello');
  assert.equal(res.words[0].transcriptConfidence, 0.92);
  assert.equal(res.words[0].isTranscriptUncertain, false);

  assert.equal(res.words[1].word, 'beautiful');
  assert.equal(res.words[1].uncertainReason, 'INSERTED_WORD');
  assert.equal(res.words[1].isTranscriptUncertain, true);

  assert.equal(res.words[2].word, 'world');
  assert.equal(res.words[2].transcriptConfidence, 0.55);
  assert.equal(res.words[2].isTranscriptUncertain, true);
  assert.equal(res.words[2].uncertainReason, 'WORD_RECOGNITION_UNCERTAIN');
});
