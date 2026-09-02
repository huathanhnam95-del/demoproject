import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const express = require('express');
const { createEchoForgeRouter } = require('../../src/routes/echo-forge');
const { createEchoForgeRouter: createFunctionsEchoForgeRouter } = require('../../functions/src/routes/echo-forge');

function wavBlob({ audioFormat = 1, channels = 1, sampleRate = 16000, bitsPerSample = 16, durationSeconds = 0.01 } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.ceil(sampleRate * durationSeconds) * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataSize);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  bytes.set(new TextEncoder().encode('fmt '), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  bytes.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, dataSize, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

async function withServer(router, callback) {
  const app = express();
  app.use('/api', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function requestBody() {
  const body = new FormData();
  body.append('audio', wavBlob(), 'sample.wav');
  body.append('challengeId', 'ef-a1-azure-phrase-001');
  body.append('evaluationMode', 'azure_phrase');
  body.append('referenceText', 'good morning');
  return body;
}

test('stateless route is feature-gated and never calls Azure while disabled', async () => {
  let calls = 0;
  const router = createEchoForgeRouter({
    environment: { ECHO_FORGE_SANDBOX_ENABLED: 'false' },
    fetchImpl: async () => { calls += 1; throw new Error('must not run'); },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/echo-forge/assess`, { method: 'POST', body: requestBody() });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'ECHO_FORGE_DISABLED');
  });
  assert.equal(calls, 0);
});

test('stateless route returns only aggregate Azure scores and no transcript or payload', async () => {
  const calls = [];
  const router = createEchoForgeRouter({
    environment: { ECHO_FORGE_SANDBOX_ENABLED: 'true', AZURE_SPEECH_KEY: 'test-key', AZURE_SPEECH_REGION: 'test-region' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ NBest: [{
          Display: 'private recognized text',
          PronunciationAssessment: { AccuracyScore: 91, FluencyScore: 82, CompletenessScore: 97 },
          Words: [{ Word: 'private' }],
        }] }),
      };
    },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/echo-forge/assess`, { method: 'POST', body: requestBody() });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, {
      success: true,
      accuracyScore: 91,
      fluencyScore: 82,
      completenessScore: 97,
      engineRevision: 'azure-echo-forge-stateless-v1',
    });
    assert.doesNotMatch(JSON.stringify(payload), /private|recognized|Display|Words/);
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /test-region\.stt\.speech\.microsoft\.com/);
  assert.equal(calls[0].options.headers['Ocp-Apim-Subscription-Key'], 'test-key');
  const pronunciationAssessment = JSON.parse(Buffer.from(
    calls[0].options.headers['Pronunciation-Assessment'],
    'base64',
  ).toString('utf8'));
  assert.equal(pronunciationAssessment.Dimension, 'Comprehensive');
});

test('stateless route rejects invalid challenge contracts before Azure', async () => {
  let calls = 0;
  const router = createEchoForgeRouter({
    environment: { ECHO_FORGE_SANDBOX_ENABLED: 'true', AZURE_SPEECH_KEY: 'key', AZURE_SPEECH_REGION: 'region' },
    fetchImpl: async () => { calls += 1; throw new Error('must not run'); },
  });
  await withServer(router, async (baseUrl) => {
    const body = requestBody();
    body.set('evaluationMode', 'v3_word');
    const response = await fetch(`${baseUrl}/api/echo-forge/assess`, { method: 'POST', body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_INPUT');
  });
  assert.equal(calls, 0);
});

test('stateless route binds ID, mode, and text to the generated manifest', async () => {
  let calls = 0;
  const router = createEchoForgeRouter({
    environment: { ECHO_FORGE_SANDBOX_ENABLED: 'true', AZURE_SPEECH_KEY: 'key', AZURE_SPEECH_REGION: 'region' },
    fetchImpl: async () => { calls += 1; throw new Error('must not run'); },
  });
  await withServer(router, async (baseUrl) => {
    for (const [field, values] of [
      ['challengeId', { challengeId: 'ef-a1-azure-phrase-999' }],
      ['evaluationMode', { evaluationMode: 'azure_word', referenceText: 'hello' }],
      ['referenceText', { referenceText: 'invented prompt' }],
    ]) {
      const body = requestBody();
      for (const [name, value] of Object.entries(values)) body.set(name, value);
      const response = await fetch(`${baseUrl}/api/echo-forge/assess`, { method: 'POST', body });
      assert.equal(response.status, 400, field);
      assert.equal((await response.json()).error, 'CHALLENGE_MISMATCH', field);
    }
  });
  assert.equal(calls, 0);
});

test('stateless route rejects malformed, non-mono PCM, and overlong WAV before Azure', async () => {
  let calls = 0;
  const router = createEchoForgeRouter({
    environment: { ECHO_FORGE_SANDBOX_ENABLED: 'true', AZURE_SPEECH_KEY: 'key', AZURE_SPEECH_REGION: 'region' },
    fetchImpl: async () => { calls += 1; throw new Error('must not run'); },
  });
  await withServer(router, async (baseUrl) => {
    for (const audio of [
      wavBlob({ channels: 2 }),
      wavBlob({ audioFormat: 3 }),
      wavBlob({ bitsPerSample: 8 }),
      wavBlob({ durationSeconds: 15.1 }),
      new Blob([new Uint8Array(64)], { type: 'audio/wav' }),
    ]) {
      const body = requestBody();
      body.set('audio', audio, 'invalid.wav');
      const response = await fetch(`${baseUrl}/api/echo-forge/assess`, { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'INVALID_AUDIO');
    }
  });
  assert.equal(calls, 0);
});

test('local and Functions routes reject non-numeric Azure aggregate scores without coercing them to zero', async () => {
  for (const createRouter of [createEchoForgeRouter, createFunctionsEchoForgeRouter]) {
    for (const invalidScore of ['', false, 'malformed']) {
      const router = createRouter({
        environment: { ECHO_FORGE_SANDBOX_ENABLED: 'true', AZURE_SPEECH_KEY: 'key', AZURE_SPEECH_REGION: 'region' },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ NBest: [{ PronunciationAssessment: {
            AccuracyScore: invalidScore,
            FluencyScore: 82,
            CompletenessScore: 97,
          } }] }),
        }),
      });
      await withServer(router, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/echo-forge/assess`, { method: 'POST', body: requestBody() });
        assert.equal(response.status, 422);
        const payload = await response.json();
        assert.equal(payload.error, 'AZURE_REQUIRED_SCORE_MISSING');
        assert.notEqual(payload.accuracyScore, 0);
      });
    }
  }
});
