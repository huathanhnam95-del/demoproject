/* eslint-disable no-console */
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

async function postAssessment(baseUrl, { audioBuffer, referenceText, questionId } = {}) {
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
  const response = await fetch(`${baseUrl}/api/read-aloud/assess`, {
    method: 'POST',
    body: formData
  });
  const payload = await response.json();
  return { response, payload };
}

(async () => {
  const { createApp } = require(path.join(process.cwd(), 'src/server/app.js'));
  const readAloudRoutes = require(path.join(process.cwd(), 'src/routes/read-aloud.js'));
  const originalMock = process.env.READ_ALOUD_AZURE_MOCK_RESPONSE;
  const originalFetch = global.fetch;
  let azureFetchCalls = 0;

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

  try {
    global.fetch = async (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('.stt.speech.microsoft.com/')) {
        azureFetchCalls += 1;
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
      audioBuffer: createMonoPcmWavBuffer({ durationMs: 240 }),
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
  } finally {
    process.env.READ_ALOUD_AZURE_MOCK_RESPONSE = originalMock;
    global.fetch = originalFetch;
    await stopServer(server);
  }

  console.log('read-aloud route tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
