/* eslint-disable no-console */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

function createOkRouter(routePath, payload) {
  const router = express.Router();
  router.get(routePath, (_req, res) => res.json(payload));
  router.post(routePath, (_req, res) => res.json(payload));
  return router;
}

async function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function captureRawBodyForMultipart(req, _res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    next();
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
}

function createFirebaseRawBodyApp(readAloudRoutes) {
  const app = express();
  app.use('/api', captureRawBodyForMultipart, readAloudRoutes);
  app.use((error, _req, res, _next) => {
    res.status(500).json({
      success: false,
      error: error?.code || 'UNHANDLED_ERROR',
      message: error?.message || 'Unhandled error.'
    });
  });
  return app;
}

function createMonoPcmWavBuffer({ sampleRate = 16000, durationMs = 200, amplitude = 1000 } = {}) {
  const sampleCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)));
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(amplitude, 44 + (index * 2));
  }
  return buffer;
}

async function postAssessment(baseUrl, { audioBuffer, referenceText, questionId, clientContext } = {}) {
  const formData = new FormData();
  if (audioBuffer) {
    formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'recording.wav');
  }
  if (referenceText != null) {
    formData.append('referenceText', referenceText);
  }
  if (questionId != null) {
    formData.append('questionId', questionId);
  }
  if (clientContext && typeof clientContext === 'object') {
    if (clientContext.clientGuideLevel != null) formData.append('clientGuideLevel', clientContext.clientGuideLevel);
    if (clientContext.clientSampleAudioFilter != null) formData.append('clientSampleAudioFilter', clientContext.clientSampleAudioFilter);
    if (clientContext.clientPromptFamilyFilter != null) formData.append('clientPromptFamilyFilter', clientContext.clientPromptFamilyFilter);
    if (clientContext.clientPromptIndexVersion != null) formData.append('clientPromptIndexVersion', clientContext.clientPromptIndexVersion);
  }
  const response = await fetch(`${baseUrl}/api/read-aloud/assess`, {
    method: 'POST',
    body: formData
  });
  const payload = await response.json();
  return { response, payload };
}

(async () => {
  const { createApp } = require(path.join(process.cwd(), 'src/server/app.js'));
  const connectedSpeechStorage = require(path.join(process.cwd(), 'src/read-aloud/connected-speech-storage.js'));
  const originalUpload = connectedSpeechStorage.uploadConnectedSpeechAudio;
  const originalPersist = connectedSpeechStorage.persistConnectedSpeechAttempt;
  const persistedAttempts = [];
  connectedSpeechStorage.uploadConnectedSpeechAudio = async ({ attemptId }) => ({
    status: 'complete',
    attemptId,
    audioPath: `read-aloud-connected-speech/raw/test/${attemptId}.wav`
  });
  connectedSpeechStorage.persistConnectedSpeechAttempt = async (record) => {
    persistedAttempts.push(JSON.parse(JSON.stringify(record)));
    return { status: 'complete', attemptId: record.attemptId };
  };
  const readAloudRoutes = require(path.join(process.cwd(), 'src/routes/read-aloud.js'));
  const originalMock = process.env.READ_ALOUD_AZURE_MOCK_RESPONSE;
  const originalWorkerUrl = process.env.CONNECTED_SPEECH_API_URL;
  const originalWorkerTimeout = process.env.CONNECTED_SPEECH_TIMEOUT_MS;
  const originalAlignmentMode = process.env.CONNECTED_SPEECH_ALIGNMENT_MODE;
  const originalAzureKey = process.env.AZURE_SPEECH_KEY;
  const originalAzureRegion = process.env.AZURE_SPEECH_REGION;
  const originalFetch = global.fetch;
  let azureFetchCalls = 0;
  let azureRequestSpec = null;
  let workerRequestSpec = null;
  let workerResponseMode = 'complete';

  const app = createApp({
    projectRoot: process.cwd(),
    logger: {
      requestMiddleware: () => (_req, _res, next) => next()
    },
    routes: {
      transcriptRoutes: createOkRouter('/transcript', { success: true }),
      dictionaryRoutes: createOkRouter('/dictionary', { success: true }),
      aiProxyRoutes: (() => {
        const router = express.Router();
        router.post('/ai-proxy', (_req, res) => res.json({ success: true }));
        router.post('/ai-feedback-stream', (_req, res) => res.json({ success: true }));
        return router;
      })(),
      adminRoutes: createOkRouter('/status', { success: true }),
      teacherSchedulerRoutes: createOkRouter('/teacher', { success: true }),
      classroomsRoutes: createOkRouter('/classrooms', { success: true }),
      entranceTestRoutes: createOkRouter('/status', { success: true }),
      readingJourneyRoutes: createOkRouter('/reading-journey/health', { success: true }),
      pronunciationTestRoutes: createOkRouter('/pronunciation-test/ping', { success: true }),
      readAloudRoutes
    },
    firebase: {
      db: null
    },
    circuitBreaker: {
      getBreakerStatus: () => ({})
    }
  });

  const { server, baseUrl } = await startServer(app);
  const { server: rawBodyServer, baseUrl: rawBodyBaseUrl } = await startServer(createFirebaseRawBodyApp(readAloudRoutes));

  try {
    global.fetch = async (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('.stt.speech.microsoft.com/')) {
        azureFetchCalls += 1;
        azureRequestSpec = args[1] || null;
        return new Response(JSON.stringify({
          RecognitionStatus: 'Success',
          NBest: [{
            Display: 'Pick it up now',
            PronunciationAssessment: {
              AccuracyScore: 92,
              FluencyScore: 88,
              CompletenessScore: 100,
              PronScore: 91
            },
            Words: [
              { Word: 'Pick', PronunciationAssessment: { AccuracyScore: 94, ErrorType: 'None' } },
              { Word: 'it', PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' } },
              { Word: 'up', PronunciationAssessment: { AccuracyScore: 88, ErrorType: 'None' } },
              { Word: 'now', PronunciationAssessment: { AccuracyScore: 96, ErrorType: 'None' } }
            ]
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === 'http://worker.test/connected-speech/analyze') {
        const requestBody = args[1]?.body;
        if (requestBody && typeof requestBody.entries === 'function') {
          for (const [key, value] of requestBody.entries()) {
            if (key === 'analysisSpec') {
              workerRequestSpec = JSON.parse(String(value));
            }
          }
        }
        if (workerResponseMode === 'malformed_json') {
          return new Response('not-json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (workerResponseMode === 'http_500') {
          return new Response(JSON.stringify({
            error: 'worker_failed'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (workerResponseMode === 'timeout') {
          const signal = args[1]?.signal;
          return new Promise((_resolve, reject) => {
            if (signal) {
              signal.addEventListener('abort', () => {
                const error = new Error('The operation was aborted.');
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            }
          });
        }
        return new Response(JSON.stringify({
          status: 'complete',
          version: 'cs-v1',
          summary: { detectedCount: 1, notDetectedCount: 0, uncertainCount: 0 },
          events: [{
            eventId: 'worker-event-1',
            family: 'catenation',
            phrase: 'Pick it',
            status: 'detected',
            confidence: 0.88,
            feedbackText: 'Worker result',
            startMs: 0,
            endMs: 520,
            evidence: { variant: 'linked', gapMs: 12 }
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(...args);
    };

    let result = await postAssessment(baseUrl, { referenceText: 'Pick it up now' });
    assert.strictEqual(result.response.status, 400, 'missing audio should return 400');
    assert.strictEqual(result.payload.error, 'INVALID_INPUT');

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 200 })
    });
    assert.strictEqual(result.response.status, 400, 'missing referenceText should return 400');
    assert.strictEqual(result.payload.error, 'INVALID_INPUT');

    azureFetchCalls = 0;
    result = await postAssessment(baseUrl, {
      audioBuffer: Buffer.from('not-a-real-wav'),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 422, 'corrupt wav should return 422');
    assert.strictEqual(result.payload.error, 'INVALID_AUDIO');
    assert.strictEqual(result.payload.details.reason, 'decode_failed');
    assert.strictEqual(azureFetchCalls, 0, 'corrupt audio should not call Azure');

    azureFetchCalls = 0;
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 60 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 422, 'too-short wav should return 422');
    assert.strictEqual(result.payload.error, 'INVALID_AUDIO');
    assert.strictEqual(result.payload.details.reason, 'too_short');
    assert.strictEqual(azureFetchCalls, 0, 'too-short audio should not call Azure');

    delete process.env.READ_ALOUD_AZURE_MOCK_RESPONSE;
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'test-region';
    azureFetchCalls = 0;
    azureRequestSpec = null;
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 300 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 200, 'the direct Azure request fixture should assess valid audio');
    assert.strictEqual(azureFetchCalls, 1, 'valid audio should make exactly one Azure request');
    const pronunciationAssessmentHeader = azureRequestSpec?.headers?.['Pronunciation-Assessment'];
    assert.ok(pronunciationAssessmentHeader, 'Azure requests should include pronunciation assessment configuration');
    const pronunciationAssessmentConfig = JSON.parse(
      Buffer.from(pronunciationAssessmentHeader, 'base64').toString('utf8')
    );
    assert.strictEqual(pronunciationAssessmentConfig.Granularity, 'Phoneme');
    assert.strictEqual(pronunciationAssessmentConfig.PhonemeAlphabet, 'IPA');
    assert.strictEqual(pronunciationAssessmentConfig.NBestPhonemeCount, 5);

    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = JSON.stringify({
      RecognitionStatus: 'Success',
      NBest: [{
        Display: 'Pick it up now',
        PronunciationAssessment: {
          AccuracyScore: 92.2,
          FluencyScore: 87.6,
          CompletenessScore: 100,
          PronScore: 91.1
        },
        Words: [
          { Word: 'Pick', PronunciationAssessment: { AccuracyScore: 95, ErrorType: 'None' } },
          { Word: 'it', PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' } },
          { Word: 'up', PronunciationAssessment: { AccuracyScore: 88, ErrorType: 'None' } },
          { Word: 'now', PronunciationAssessment: { AccuracyScore: 96, ErrorType: 'None' } }
        ]
      }]
    });

    azureFetchCalls = 0;
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 300 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 200, 'mocked Azure success should return 200');
    assert.strictEqual(result.payload.success, true);
    assert.strictEqual(result.payload.accuracyScore, 92);
    assert.strictEqual(result.payload.fluencyScore, 88);
    assert.strictEqual(result.payload.completenessScore, 100);
    assert.strictEqual(result.payload.pronScore, 91);
    assert.strictEqual(result.payload.recognizedText, 'Pick it up now');
    assert.deepStrictEqual(result.payload.words, [
      { word: 'Pick', accuracyScore: 95, errorType: 'None' },
      { word: 'it', accuracyScore: 90, errorType: 'None' },
      { word: 'up', accuracyScore: 88, errorType: 'None' },
      { word: 'now', accuracyScore: 96, errorType: 'None' }
    ]);
    assert.strictEqual(azureFetchCalls, 0, 'mocked Azure success should not hit the network');
    assert.strictEqual(result.payload.connectedSpeech.status, 'not_applicable', 'connected speech should be skipped without questionId');
    assert.ok(persistedAttempts.length >= 1, 'attempt persistence should run without questionId');
    assert.strictEqual(persistedAttempts[0].audioStatus, 'complete', 'persistence should store audio status');
    assert.strictEqual(persistedAttempts[0].workerStatus, 'not_applicable', 'persistence should store worker status');
    assert.deepStrictEqual(persistedAttempts[0].eventFamilyCounts, {}, 'persistence should store empty family counts when no connected speech is applicable');

    result = await postAssessment(rawBodyBaseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 300 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'Firebase rawBody multipart uploads should parse and reach assessment logic');
    assert.strictEqual(result.payload.success, true);
    assert.strictEqual(result.payload.accuracyScore, 92);

    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = JSON.stringify({
      RecognitionStatus: 'Success',
      NBest: [{
        Display: 'Pick it up now',
        AccuracyScore: 91,
        Words: [
          { Word: 'Pick', AccuracyScore: 94 },
          { Word: 'it', AccuracyScore: 90 },
          { Word: 'up', AccuracyScore: 88 },
          { Word: 'now', AccuracyScore: 92 }
        ]
      }]
    });

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 300 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 200, 'direct Azure score fields should still return 200');
    assert.strictEqual(result.payload.success, true);
    assert.strictEqual(result.payload.accuracyScore, 91);
    assert.strictEqual(result.payload.fluencyScore, null);
    assert.strictEqual(result.payload.completenessScore, null);
    assert.strictEqual(result.payload.pronScore, null);
    assert.deepStrictEqual(result.payload.words, [
      { word: 'Pick', accuracyScore: 94, errorType: 'None' },
      { word: 'it', accuracyScore: 90, errorType: 'None' },
      { word: 'up', accuracyScore: 88, errorType: 'None' },
      { word: 'now', accuracyScore: 92, errorType: 'None' }
    ]);

    azureFetchCalls = 0;
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 46000 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 422, 'too-long read-aloud wav should return 422');
    assert.strictEqual(result.payload.error, 'INVALID_AUDIO');
    assert.strictEqual(result.payload.details.reason, 'too_long');
    assert.strictEqual(result.payload.details.maxDurationMs, 45000);
    assert.strictEqual(azureFetchCalls, 0, 'too-long read-aloud audio should not call Azure');

    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = JSON.stringify({
      RecognitionStatus: 'Success',
      NBest: [{
        Display: 'Pick it up now',
        Words: [
          { Word: 'Pick' },
          { Word: 'it' },
          { Word: 'up' },
          { Word: 'now' }
        ]
      }]
    });
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 300 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 502, 'missing pronunciation scores should surface as an assessment failure');
    assert.strictEqual(result.payload.error, 'AZURE_ASSESSMENT_FAILED');
    assert.strictEqual(result.payload.details.reason, 'scores_unavailable');
    assert.strictEqual(result.payload.details.recognizedText, 'Pick it up now');

    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = JSON.stringify({
      RecognitionStatus: 'Success',
      NBest: [{
        Display: 'Pick it up now',
        PronunciationAssessment: {
          AccuracyScore: 0,
          FluencyScore: 0,
          CompletenessScore: 0,
          PronScore: 0
        },
        Words: [
          { Word: 'Pick', PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'None' } },
          { Word: 'it', PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'None' } },
          { Word: 'up', PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'None' } },
          { Word: 'now', PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'None' } }
        ]
      }]
    });
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 300 }),
      referenceText: 'Pick it up now'
    });
    assert.strictEqual(result.response.status, 502, 'all-zero pronunciation scores should surface as an assessment failure');
    assert.strictEqual(result.payload.error, 'AZURE_ASSESSMENT_FAILED');
    assert.strictEqual(result.payload.details.reason, 'scores_unavailable');
    assert.strictEqual(result.payload.details.scorePattern, 'all_zero');
    assert.strictEqual(result.payload.details.recognizedText, 'Pick it up now');

    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = JSON.stringify({
      RecognitionStatus: 'Success',
      NBest: [{
        Display: 'Pick it up now',
        PronunciationAssessment: {
          AccuracyScore: 94.1,
          FluencyScore: 88.8,
          CompletenessScore: 100,
          PronScore: 92.3
        },
        Words: [
          { Word: 'Pick', Offset: 0, Duration: 3000000, PronunciationAssessment: { AccuracyScore: 93, ErrorType: 'None' } },
          { Word: 'it', Offset: 3120000, Duration: 1900000, PronunciationAssessment: { AccuracyScore: 91, ErrorType: 'None' } },
          { Word: 'up', Offset: 5100000, Duration: 2100000, PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' } },
          { Word: 'now', Offset: 7300000, Duration: 2500000, PronunciationAssessment: { AccuracyScore: 94, ErrorType: 'None' } }
        ]
      }]
    });

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'mocked Azure success with questionId should return 200');
    assert.strictEqual(result.payload.connectedSpeech.status, 'complete', 'connected speech should run when questionId is present');
    assert.ok(Array.isArray(result.payload.connectedSpeech.events), 'connected speech should include events');
    assert.ok(result.payload.connectedSpeech.events.length >= 1, 'connected speech should return at least one event for a linked prompt');
    const linkedRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(linkedRecord.audioStatus, 'complete', 'linked attempt should persist the audio status');
    assert.ok(String(linkedRecord.workerStatus || '').length > 0, 'linked attempt should persist worker status');
    assert.ok(linkedRecord.connectedSpeechVersion, 'linked attempt should persist the connected speech version');
    assert.ok(linkedRecord.eventFamilyCounts.catenation >= 1, 'linked attempt should persist family counts');
    assert.ok(linkedRecord.connectedSpeechEvents[0].evidence, 'linked attempt should persist event evidence');
    assert.strictEqual(typeof linkedRecord.referenceWordCount, 'number', 'linked attempt should persist prompt context');
    assert.strictEqual(linkedRecord.scoringMode, 'heuristic', 'linked attempt should persist scoring mode');
    assert.strictEqual(linkedRecord.connectedSpeechPrimarySource, 'heuristic', 'linked attempt should persist primary source');

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Did you see it?',
      questionId: '2',
      clientContext: {
        clientGuideLevel: 'v3_sound_changes',
        clientSampleAudioFilter: 'available',
        clientPromptFamilyFilter: 'sound_changes',
        clientPromptIndexVersion: '1'
      }
    });
    assert.strictEqual(result.response.status, 200, 'client context assessment should return 200');
    const contextualRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.deepStrictEqual(contextualRecord.clientContext, {
      guideLevel: 'v3_sound_changes',
      sampleAudioFilter: 'available',
      promptFamilyFilter: 'sound_changes',
      promptIndexVersion: '1'
    }, 'client context should persist the learner filter state');
    assert.strictEqual(contextualRecord.promptIndexVersion, '1', 'prompt index version should persist on the attempt');
    assert.ok(contextualRecord.promptFeatureSnapshot, 'prompt feature snapshot should persist on the attempt');
    assert.strictEqual(contextualRecord.promptFeatureSnapshot.questionId, '2', 'prompt snapshot should match the assessed prompt');

    process.env.CONNECTED_SPEECH_ALIGNMENT_MODE = 'shadow_mfa';
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'shadow mode assessment should return 200');
    const shadowRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(shadowRecord.requestedAlignmentMode, 'shadow_mfa', 'shadow mode should preserve the requested mode');
    assert.strictEqual(shadowRecord.scoringMode, 'heuristic', 'shadow mode should fall back to heuristic until MFA exists');
    assert.strictEqual(shadowRecord.connectedSpeechPrimarySource, 'heuristic', 'shadow mode should keep heuristic as the learner-facing source');
    assert.ok(shadowRecord.connectedSpeechShadow, 'shadow mode should persist a shadow placeholder record');
    assert.strictEqual(shadowRecord.connectedSpeechShadow.shadowKind, 'placeholder', 'shadow placeholder should be marked explicitly');
    assert.strictEqual(shadowRecord.connectedSpeechShadow.engine, 'none', 'shadow placeholder should note that no MFA engine ran');
    assert.strictEqual(shadowRecord.connectedSpeechShadow.mode, 'shadow_mfa', 'shadow placeholder should carry the rollout mode');
    assert.strictEqual(shadowRecord.connectedSpeechShadow.primarySource, 'heuristic', 'shadow placeholder should note the primary source');
    assert.strictEqual(shadowRecord.alignmentFallbackReason, 'mfa_unavailable', 'shadow mode should record the fallback reason');

    process.env.CONNECTED_SPEECH_ALIGNMENT_MODE = 'mfa_primary';
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'primary mode assessment should return 200');
    const primaryRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(primaryRecord.requestedAlignmentMode, 'mfa_primary', 'primary mode should preserve the requested mode');
    assert.strictEqual(primaryRecord.scoringMode, 'heuristic', 'primary mode should fall back to heuristic until MFA exists');
    assert.strictEqual(primaryRecord.connectedSpeechPrimarySource, 'heuristic', 'primary mode should mark heuristic as the actual source when MFA is unavailable');
    assert.strictEqual(primaryRecord.alignmentFallbackReason, 'mfa_unavailable', 'primary mode should record the fallback reason');
    assert.strictEqual(primaryRecord.connectedSpeechShadow, null, 'primary mode should not persist a shadow placeholder');

    process.env.CONNECTED_SPEECH_API_URL = 'http://worker.test/connected-speech/analyze';
    workerRequestSpec = null;
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'worker-backed assessment should return 200');
    assert.strictEqual(result.payload.connectedSpeech.events[0].eventId, 'worker-event-1', 'worker responses should surface in the route payload');
    assert.ok(workerRequestSpec, 'worker requests should include an analysis spec');
    assert.ok(Array.isArray(workerRequestSpec.events), 'worker analysis spec should include event specs');
    assert.ok(workerRequestSpec.events.length >= 1, 'worker analysis spec should include at least one event');
    assert.ok(workerRequestSpec.events[0].detectorConfig, 'worker event specs should preserve detector config');
    assert.ok(workerRequestSpec.events[0].feedbackTemplates, 'worker event specs should preserve feedback templates');
    assert.strictEqual(workerRequestSpec.events[0].status, undefined, 'worker event specs should not send pre-scored statuses');
    delete process.env.CONNECTED_SPEECH_API_URL;

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260, amplitude: 32767 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'clipped audio should still return Azure results');
    assert.strictEqual(result.payload.connectedSpeech.status, 'unavailable', 'clipped audio should not return connected speech scores');
    const clippedRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(clippedRecord.workerStatus, 'not_rateable', 'clipped audio should persist not_rateable worker status');
    assert.strictEqual(String(clippedRecord.audioQualityReason || clippedRecord.audioQuality?.reason || ''), 'clipped', 'clipped audio should persist its downgrade reason');
    assert.strictEqual(clippedRecord.audioQualityPassed, false, 'clipped audio should persist its quality pass flag');

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Did you see it?',
      questionId: '2'
    });
    assert.strictEqual(result.response.status, 200, 'mocked Azure success with yod coalescence should return 200');
    assert.strictEqual(result.payload.connectedSpeech.status, 'complete', 'connected speech should run for did you-style prompts');
    assert.ok(
      result.payload.connectedSpeech.events.some((event) => event.family === 'yod_coalescence'),
      'connected speech should surface yod coalescence for did you-style prompts'
    );

    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = JSON.stringify({
      RecognitionStatus: 'Success',
      NBest: [{
        Display: 'Hello',
        PronunciationAssessment: {
          AccuracyScore: 90.1,
          FluencyScore: 88.4,
          CompletenessScore: 100,
          PronScore: 89.9
        },
        Words: [
          { Word: 'Hello', Offset: 0, Duration: 3000000, PronunciationAssessment: { AccuracyScore: 91, ErrorType: 'None' } }
        ]
      }]
    });

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260, amplitude: 32767 }),
      referenceText: 'Hello',
      questionId: '3'
    });
    assert.strictEqual(result.response.status, 200, 'clipped single-word prompt should still return Azure results');
    assert.strictEqual(result.payload.connectedSpeech.status, 'not_applicable', 'no connected-speech events should outrank clipped audio');
    const clippedSingleWordRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(clippedSingleWordRecord.workerStatus, 'not_applicable', 'no-event clipped prompt should persist not_applicable worker status');

    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Hello',
      questionId: '3'
    });
    assert.strictEqual(result.response.status, 200, 'single-word prompt should still return 200');
    assert.strictEqual(result.payload.connectedSpeech.status, 'not_applicable', 'single-word prompt should not create connected speech events');
    const notApplicableRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(notApplicableRecord.workerStatus, 'not_applicable', 'not applicable prompt should persist not_applicable worker status');
    assert.deepStrictEqual(notApplicableRecord.eventFamilyCounts, {}, 'not applicable prompt should persist empty family counts');

    process.env.CONNECTED_SPEECH_API_URL = 'http://worker.test/connected-speech/analyze';
    workerResponseMode = 'malformed_json';
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'malformed worker JSON should still return 200');
    assert.strictEqual(result.payload.connectedSpeech.status, 'complete', 'malformed worker JSON should fall back to the local analysis');
    assert.ok(result.payload.connectedSpeech.events.length >= 1, 'malformed worker JSON should preserve local connected speech events');
    const malformedWorkerRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(malformedWorkerRecord.workerStatus, 'fallback', 'malformed worker JSON should persist fallback worker status');

    workerResponseMode = 'timeout';
    process.env.CONNECTED_SPEECH_TIMEOUT_MS = '25';
    result = await postAssessment(baseUrl, {
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 260 }),
      referenceText: 'Pick it up now',
      questionId: '1'
    });
    assert.strictEqual(result.response.status, 200, 'worker timeout should still return 200');
    assert.strictEqual(result.payload.connectedSpeech.status, 'complete', 'worker timeout should fall back to the local analysis');
    const timeoutWorkerRecord = persistedAttempts[persistedAttempts.length - 1];
    assert.strictEqual(timeoutWorkerRecord.workerStatus, 'fallback', 'worker timeout should persist fallback worker status');
    delete process.env.CONNECTED_SPEECH_API_URL;
  } finally {
    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = originalMock;
    process.env.CONNECTED_SPEECH_API_URL = originalWorkerUrl;
    process.env.CONNECTED_SPEECH_TIMEOUT_MS = originalWorkerTimeout;
    process.env.CONNECTED_SPEECH_ALIGNMENT_MODE = originalAlignmentMode;
    if (originalAzureKey === undefined) delete process.env.AZURE_SPEECH_KEY;
    else process.env.AZURE_SPEECH_KEY = originalAzureKey;
    if (originalAzureRegion === undefined) delete process.env.AZURE_SPEECH_REGION;
    else process.env.AZURE_SPEECH_REGION = originalAzureRegion;
    connectedSpeechStorage.uploadConnectedSpeechAudio = originalUpload;
    connectedSpeechStorage.persistConnectedSpeechAttempt = originalPersist;
    global.fetch = originalFetch;
    await stopServer(rawBodyServer);
    await stopServer(server);
  }

  console.log('read-aloud route tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
