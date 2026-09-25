'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GroqWhisperAdapter,
  registerReconstructionProvider,
  getReconstructionProvider
} = require('../../functions/src/services/practice-pronunciation/reference-reconstruction');

const {
  detectMaterialAmbiguities,
  applyDisambiguation
} = require('../../functions/src/services/practice-pronunciation/ambiguity-detector');

const { assessSpokenResponse } = require('../../functions/src/services/azure-speech/two-pass-asr');

test('GroqWhisperAdapter: raises RECONSTRUCTION_QUOTA_EXHAUSTED on HTTP 429 without silent fallback', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    text: async () => 'Rate limit exceeded'
  });

  const adapter = new GroqWhisperAdapter({
    apiKey: 'mock-groq-key',
    fetchFn: mockFetch
  });

  const dummyAudio = Buffer.alloc(16000); // 0.5s of 16kHz PCM

  await assert.rejects(
    () => adapter.transcribe({ audioBuffer: dummyAudio }),
    (err) => {
      assert.equal(err.code, 'RECONSTRUCTION_QUOTA_EXHAUSTED');
      assert.equal(err.status, 429);
      assert.equal(err.provider, 'groq-whisper');
      return true;
    }
  );
});

test('GroqWhisperAdapter: raises RECONSTRUCTION_UNAVAILABLE on HTTP 503 without silent fallback', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    text: async () => 'Service overloaded'
  });

  const adapter = new GroqWhisperAdapter({
    apiKey: 'mock-groq-key',
    fetchFn: mockFetch
  });

  const dummyAudio = Buffer.alloc(16000);

  await assert.rejects(
    () => adapter.transcribe({ audioBuffer: dummyAudio }),
    (err) => {
      assert.equal(err.code, 'RECONSTRUCTION_UNAVAILABLE');
      assert.equal(err.status, 503);
      assert.equal(err.provider, 'groq-whisper');
      return true;
    }
  );
});

test('GroqWhisperAdapter: parses verbose_json words, timestamps, and probabilities', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      text: 'There are three trees',
      words: [
        { word: 'There', start: 0.1, end: 0.3, probability: 0.96 },
        { word: 'are', start: 0.35, end: 0.5, probability: 0.94 },
        { word: 'three', start: 0.55, end: 0.9, probability: 0.72 },
        { word: 'trees', start: 0.95, end: 1.4, probability: 0.88 }
      ]
    })
  });

  const adapter = new GroqWhisperAdapter({
    apiKey: 'mock-groq-key',
    fetchFn: mockFetch
  });

  const dummyAudio = Buffer.alloc(32000);
  const result = await adapter.transcribe({ audioBuffer: dummyAudio });

  assert.equal(result.rawTranscript, 'There are three trees');
  assert.equal(result.tokens.length, 4);
  assert.equal(result.tokens[2].word, 'three');
  assert.equal(result.tokens[2].startMs, 550);
  assert.equal(result.tokens[2].endMs, 900);
  assert.equal(result.tokens[2].confidence, 0.72);
});

test('AmbiguityDetector: flags known minimal pair (three vs tree) with borderline confidence', () => {
  const tokens = [
    { index: 0, word: 'The', startMs: 100, endMs: 250, confidence: 0.95 },
    { index: 1, word: 'number', startMs: 300, endMs: 600, confidence: 0.92 },
    { index: 2, word: 'three', startMs: 650, endMs: 950, confidence: 0.74 }
  ];

  const result = detectMaterialAmbiguities(tokens, { ambiguityConfidenceThreshold: 0.85 });
  assert.equal(result.hasMaterialAmbiguity, true);
  assert.equal(result.ambiguities.length, 1);
  assert.equal(result.ambiguities[0].tokenIndex, 2);
  assert.equal(result.ambiguities[0].spokenWord, 'three');
  assert.ok(result.ambiguities[0].candidates.includes('tree'));
  assert.ok(result.ambiguities[0].candidates.includes('free'));
});

test('AmbiguityDetector: auto-proceeds for ordinary words without material minimal pair overlap', () => {
  const tokens = [
    { index: 0, word: 'The', startMs: 100, endMs: 250, confidence: 0.95 },
    { index: 1, word: 'ecosystem', startMs: 300, endMs: 800, confidence: 0.65 }, // low confidence, but not a minimal pair
    { index: 2, word: 'survives', startMs: 850, endMs: 1300, confidence: 0.91 }
  ];

  const result = detectMaterialAmbiguities(tokens, { ambiguityConfidenceThreshold: 0.85 });
  assert.equal(result.hasMaterialAmbiguity, false);
  assert.equal(result.ambiguities.length, 0);
});

test('AmbiguityDetector: applies confirmed student disambiguation to tokens', () => {
  const tokens = [
    { index: 0, word: 'There', startMs: 100, endMs: 250, confidence: 0.95 },
    { index: 1, word: 'are', startMs: 300, endMs: 450, confidence: 0.95 },
    { index: 2, word: 'three', startMs: 500, endMs: 800, confidence: 0.70 }
  ];

  const { resolvedText, appliedCount, tokens: updated } = applyDisambiguation(tokens, { '2': 'tree' });
  assert.equal(appliedCount, 1);
  assert.equal(resolvedText, 'There are tree');
  assert.equal(updated[2].word, 'tree');
});

test('assessSpokenResponse: scores the best hypothesis and retains ambiguity evidence', async () => {
  const dummyAudio = Buffer.alloc(32000);
  const mockTokens = [
    { index: 0, word: 'I', startMs: 100, endMs: 200, confidence: 0.95 },
    { index: 1, word: 'saw', startMs: 250, endMs: 500, confidence: 0.92 },
    { index: 2, word: 'three', startMs: 550, endMs: 850, confidence: 0.70 },
    { index: 3, word: 'birds', startMs: 900, endMs: 1300, confidence: 0.90 }
  ];

  const mockProvider = {
    transcribe: async () => ({
      provider: 'mock-whisper',
      model: 'whisper-large-v3',
      audioHash: 'hash123',
      rawTranscript: 'I saw three birds',
      tokens: mockTokens,
      confidence: 0.87,
      detectedSpeechDurationMs: 1300,
      transcriptRevision: 'rev-1'
    })
  };

  const response = await assessSpokenResponse(
    { mode: 'retell_lecture', audioBuffer: dummyAudio,
      audioIdentity: { sampleRateHz: 16000, sampleCount: 16000 }, attemptId: 'asmt-ambig-1' },
    { provider: mockProvider, useMock: true, ambiguityOptions: { ambiguityConfidenceThreshold: 0.85 } }
  );

  assert.equal(response.status, 'completed');
  assert.equal(response.reference.scoringText, 'I saw three birds');
  assert.equal(response.transcriptUncertainty.ambiguousCandidates.length, 1);
  assert.equal(response.transcriptUncertainty.ambiguousCandidates[0].spokenWord, 'three');
  assert.equal(typeof response.overallScores.accuracyScore, 'number');
});

test('assessSpokenResponse: ignores legacy confirmation input for new V3 scoring', async () => {
  const dummyAudio = Buffer.alloc(32000);
  const mockTokens = [
    { index: 0, word: 'I', startMs: 100, endMs: 200, confidence: 0.95 },
    { index: 1, word: 'saw', startMs: 250, endMs: 500, confidence: 0.92 },
    { index: 2, word: 'three', startMs: 550, endMs: 850, confidence: 0.70 },
    { index: 3, word: 'birds', startMs: 900, endMs: 1300, confidence: 0.90 }
  ];

  const mockProvider = {
    transcribe: async () => ({
      provider: 'mock-whisper',
      model: 'whisper-large-v3',
      audioHash: 'hash123',
      rawTranscript: 'I saw three birds',
      tokens: mockTokens,
      confidence: 0.87,
      detectedSpeechDurationMs: 1300,
      transcriptRevision: 'rev-1'
    })
  };

  const response = await assessSpokenResponse(
    { mode: 'describe_image', audioBuffer: dummyAudio,
      audioIdentity: { sampleRateHz: 16000, sampleCount: 16000 }, attemptId: 'asmt-ambig-2' },
    {
      provider: mockProvider,
      confirmedAmbiguities: { '2': 'tree' },
      useMock: true
    }
  );

  assert.equal(response.status, 'completed');
  assert.equal(response.reference.scoringText, 'I saw three birds');
  assert.equal(response.overallScores.completenessScore, null, 'completenessScore must remain null for spoken responses');
  assert.ok(typeof response.overallScores.pronunciationScore === 'number');
});

test('GroqWhisperAdapter: validates audioBuffer input and falls back to segments when words is missing', async () => {
  const adapter = new GroqWhisperAdapter({
    apiKey: 'mock-key',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'Hello world',
        segments: [
          {
            words: [
              { word: 'Hello', start: 0.1, end: 0.5, probability: 0.95 },
              { word: 'world', start: 0.6, end: 1.0, probability: 0.92 }
            ]
          }
        ]
      })
    })
  });

  await assert.rejects(() => adapter.transcribe({ audioBuffer: null }), /VALID_AUDIO_BUFFER_REQUIRED/);
  await assert.rejects(() => adapter.transcribe({ audioBuffer: Buffer.alloc(0) }), /VALID_AUDIO_BUFFER_REQUIRED/);

  const res = await adapter.transcribe({ audioBuffer: Buffer.alloc(16000) });
  assert.equal(res.tokens.length, 2);
  assert.equal(res.tokens[0].word, 'Hello');
  assert.equal(res.tokens[1].word, 'world');
});

test('AmbiguityDetector: safely handles null confirmations and empty tokens without throwing', () => {
  const tokens = [{ index: 0, word: 'hello', confidence: 0.9, startMs: 0, endMs: 200 }];
  const res = applyDisambiguation(tokens, null);
  assert.equal(res.appliedCount, 0);
  assert.equal(res.resolvedText, 'hello');

  const emptyRes = applyDisambiguation(null, null);
  assert.equal(emptyRes.appliedCount, 0);
  assert.equal(emptyRes.resolvedText, '');
});

test('assessSpokenResponse: rejects non-spoken mode and handles no speech detected', async () => {
  await assert.rejects(
    () => assessSpokenResponse({ mode: 'invalid_mode', audioBuffer: Buffer.alloc(16000) }),
    /INVALID_SPOKEN_RESPONSE_MODE/
  );

  const emptyProvider = {
    transcribe: async () => ({
      provider: 'mock-whisper',
      model: 'whisper-large-v3',
      rawTranscript: '',
      tokens: [],
      confidence: 0,
      detectedSpeechDurationMs: 0
    })
  };

  const emptyRes = await assessSpokenResponse(
    { mode: 'describe_image', audioBuffer: Buffer.alloc(16000) },
    { provider: emptyProvider }
  );

  assert.equal(emptyRes.status, 'unrateable');
  assert.equal(emptyRes.reason, 'NO_SPEECH_DETECTED');
  assert.equal(emptyRes.overallScores.completenessScore, null);
});

test('GroqWhisperAdapter: filters non-speech bracketed tags and marks pure silence as unrateable', async () => {
  const adapter = new GroqWhisperAdapter({
    apiKey: 'mock-key',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        text: '[music] [applause]',
        words: [
          { word: '[music]', start: 0.1, end: 0.8, probability: 0.8 },
          { word: '[applause]', start: 0.9, end: 1.5, probability: 0.75 }
        ]
      })
    })
  });

  const res = await adapter.transcribe({ audioBuffer: Buffer.alloc(16000) });
  assert.equal(res.rawTranscript, '');
  assert.equal(res.tokens.length, 0);

  const assessed = await assessSpokenResponse(
    { mode: 'describe_image', audioBuffer: Buffer.alloc(16000) },
    { provider: adapter }
  );
  assert.equal(assessed.status, 'unrateable');
  assert.equal(assessed.reason, 'NO_SPEECH_DETECTED');
});

test('confirm-reference: legacy endpoint rejects new V3 and non-awaiting jobs', async () => {
  const { createAiScoringRouter } = require('../../functions/src/routes/ai-scoring');
  const express = require('express');

  const jobsData = new Map();
  const outboxData = new Map();
  const reservationsData = new Map();
  reservationsData.set('asmt-test-1', {
    status: 'reserved',
    uid: 'student-999',
    credits: 17
  });

  const mockDb = {
    collection: (colName) => ({
      doc: (id) => {
        const getDoc = () => {
          if (colName === 'aiCreditReservations') return reservationsData.get(id);
          if (colName === 'aiScoringOutbox') return outboxData.get(id);
          return jobsData.get(id);
        };
        const docRef = {
          get: async () => ({
            exists: getDoc() !== undefined,
            data: () => getDoc()
          }),
          update: async (patch) => {
            const curr = getDoc() || {};
            if (colName === 'aiCreditReservations') reservationsData.set(id, { ...curr, ...patch });
            else if (colName === 'aiScoringOutbox') outboxData.set(id, { ...curr, ...patch });
            else jobsData.set(id, { ...curr, ...patch });
          },
          set: async (data) => {
            if (colName === 'aiCreditReservations') reservationsData.set(id, data);
            else if (colName === 'aiScoringOutbox') outboxData.set(id, data);
            else jobsData.set(id, data);
          },
          delete: async () => {
            if (colName === 'aiCreditReservations') reservationsData.delete(id);
            else if (colName === 'aiScoringOutbox') outboxData.delete(id);
            else jobsData.delete(id);
          }
        };
        return docRef;
      }
    }),
    runTransaction: async (cb) => {
      const tx = {
        get: async (ref) => ref.get(),
        update: (ref, data) => ref.update(data),
        set: (ref, data) => ref.set(data),
        delete: (ref) => ref.delete()
      };
      return cb(tx);
    }
  };

  const mockDispatcher = {
    dispatched: [],
    dispatch: async (id) => { mockDispatcher.dispatched.push(id); }
  };

  jobsData.set('asmt-test-1', {
    uid: 'student-999',
    status: 'awaiting_reference_confirmation',
    stage: 'awaiting_reference_confirmation'
  });

  const router = createAiScoringRouter({
    db: mockDb,
    taskDispatcher: mockDispatcher,
    env: { AI_SCORING_QUOTES_ENABLED: 'true' }
  });

  // Mock settlementService on router scope or inject
  // 1. Test confirmation success
  const reqSuccess = {
    params: { assessmentId: 'asmt-test-1' },
    body: { confirmations: { '2': 'tree' } },
    uid: 'student-999',
    user: { uid: 'student-999', role: 'student' }
  };

  let resPayload = null;
  let resStatus = 200;
  const res = {
    status: (s) => { resStatus = s; return res; },
    json: (data) => { resPayload = data; }
  };

  // Find the route handler
  const confirmRoute = router.stack.find(r => r.route && r.route.path === '/assessments/:assessmentId/confirm-reference');
  assert.ok(confirmRoute, 'confirm-reference route must exist');

  // Execute confirmation
  const handler = confirmRoute.route.stack[confirmRoute.route.stack.length - 1].handle;
  await handler(reqSuccess, res);

  assert.equal(resStatus, 200);
  assert.equal(resPayload.status, 'queued');
  assert.equal(jobsData.get('asmt-test-1').status, 'queued');
  assert.deepEqual(jobsData.get('asmt-test-1').confirmedAmbiguities, { '2': 'tree' });
  // Verify outbox record re-created!
  assert.ok(outboxData.has('asmt-test-1'), 'aiScoringOutbox record must be re-created');
  assert.equal(outboxData.get('asmt-test-1').status, 'pending');
  assert.ok(mockDispatcher.dispatched.includes('asmt-test-1'));

  // A resumed legacy job cannot be canceled through the confirmation endpoint.
  const reqCancel = {
    params: { assessmentId: 'asmt-test-1' },
    body: { action: 'cancel' },
    uid: 'student-999',
    user: { uid: 'student-999', role: 'student' }
  };
  await handler(reqCancel, res);
  assert.equal(resStatus, 409);
  assert.equal(resPayload.error, 'LEGACY_CONFIRMATION_STATE_REQUIRED');
  assert.equal(jobsData.get('asmt-test-1').status, 'queued');

  jobsData.set('asmt-v3', { uid: 'student-999', engineVersion: 'bel.speech.v3',
    status: 'awaiting_reference_confirmation' });
  await handler({ ...reqSuccess, params: { assessmentId: 'asmt-v3' } }, res);
  assert.equal(resStatus, 409);

  // 3. Test unauthorized user rejection
  const reqUnauthorized = {
    params: { assessmentId: 'asmt-test-1' },
    body: { action: 'cancel' },
    uid: 'wrong-user',
    user: { uid: 'wrong-user', role: 'student' }
  };
  await handler(reqUnauthorized, res);
  assert.equal(resStatus, 403);
});
