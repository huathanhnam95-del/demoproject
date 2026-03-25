#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();

const { spawn } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
      if (response.ok) return;
    } catch (_error) {
      // ignore until timeout
    }
    await wait(300);
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createMonoWav({ sampleRate, durationMs, amplitude = 0.2 }) {
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * amplitude;
    const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + (index * 2));
  }

  return buffer;
}

function createMalformedFmtWav() {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(0, 16);
  buffer.write('data', 20);
  buffer.writeUInt32LE(0, 24);
  return buffer;
}

function buildAssessForm(audioBuffer, fileName = 'recording.wav', overrides = {}) {
  const formData = new FormData();
  const fields = {
    itemId: 'core-thin-001',
    word: 'thin',
    referenceText: 'thin',
    referencePhonemes: ['\u03b8', '\u026a', 'n'],
    referencePhonemeIndex: 0,
    targetPhoneme: '\u03b8',
    contrastPartnerPhoneme: 't',
    targetPosition: 'initial',
    contrastId: 'theta_t',
    category: 'dental-fricative',
    isPractice: false,
    ...overrides
  };

  formData.append(overrides.audioFieldName || 'audio', new Blob([audioBuffer], { type: 'audio/wav' }), fileName);
  formData.append('itemId', String(fields.itemId));
  formData.append('word', String(fields.word));
  formData.append('referenceText', String(fields.referenceText));
  formData.append('referencePhonemes', JSON.stringify(fields.referencePhonemes));
  formData.append('referencePhonemeIndex', String(fields.referencePhonemeIndex));
  formData.append('targetPhoneme', String(fields.targetPhoneme));
  formData.append('contrastPartnerPhoneme', String(fields.contrastPartnerPhoneme || ''));
  formData.append('targetPosition', String(fields.targetPosition));
  formData.append('contrastId', String(fields.contrastId));
  formData.append('category', String(fields.category));
  formData.append('isPractice', String(Boolean(fields.isPractice)));
  return formData;
}

function buildVowelHintForm(audioBuffer, category = 'dental-fricative') {
  const formData = new FormData();
  formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'recording.wav');
  formData.append('itemId', 'core-thin-001');
  formData.append('targetPhoneme', '\u03b8');
  formData.append('category', category);
  return formData;
}

function buildMockAzurePayload() {
  return {
    RecognitionStatus: 'Success',
    NBest: [
      {
        Confidence: 0.99,
        Words: [
          {
            Word: 'thin',
            PronunciationAssessment: {
              AccuracyScore: 78,
              ErrorType: 'Mispronunciation'
            },
            Phonemes: [
              {
                Phoneme: '\u03b8',
                PronunciationAssessment: {
                  AccuracyScore: 64,
                  NBestPhonemes: [
                    { Phoneme: 't', Score: 71 },
                    { Phoneme: '\u03b8', Score: 24 }
                  ]
                }
              },
              {
                Phoneme: '\u026a',
                PronunciationAssessment: {
                  AccuracyScore: 82
                }
              },
              {
                Phoneme: 'n',
                PronunciationAssessment: {
                  AccuracyScore: 86
                }
              }
            ]
          }
        ]
      }
    ]
  };
}

function buildMockFinalOmissionPayload() {
  return {
    RecognitionStatus: 'Success',
    NBest: [
      {
        Confidence: 0.98,
        Words: [
          {
            Word: 'tent',
            PronunciationAssessment: {
              AccuracyScore: 55,
              ErrorType: 'Mispronunciation'
            },
            Phonemes: [
              {
                Phoneme: 't',
                PronunciationAssessment: {
                  AccuracyScore: 81,
                  NBestPhonemes: [{ Phoneme: 't', Score: 81 }]
                }
              },
              {
                Phoneme: '\u025b',
                PronunciationAssessment: {
                  AccuracyScore: 74
                }
              },
              {
                Phoneme: 'n',
                PronunciationAssessment: {
                  AccuracyScore: 79
                }
              }
            ]
          }
        ]
      }
    ]
  };
}

async function postForm(url, formData) {
  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

function startServerProcess(port, envOverrides = {}) {
  return spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      ...envOverrides
    },
    stdio: 'inherit'
  });
}

async function withServer(port, envOverrides, fn) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = startServerProcess(port, envOverrides);

  try {
    await waitForServer(baseUrl, 30000);
    await fn(baseUrl);
  } finally {
    serverProcess.kill();
    await wait(400);
  }
}

async function runRejectAndHintChecks(baseUrl) {
  const shortWav = createMonoWav({ sampleRate: 16000, durationMs: 120 });
  const assess = await postForm(`${baseUrl}/api/pronunciation-test/assess`, buildAssessForm(shortWav, 'short.wav'));
  assert(assess.response.status === 400, `Expected /assess to reject short audio with 400, got ${assess.response.status}`);
  assert(assess.json?.error === 'INVALID_AUDIO', `Expected INVALID_AUDIO, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.details?.reason === 'too_short', `Expected too_short reason, got ${JSON.stringify(assess.json)}`);

  const vowelHint = await postForm(`${baseUrl}/api/pronunciation-test/vowel-hint`, buildVowelHintForm(shortWav));
  assert(vowelHint.response.ok, `Expected /vowel-hint to return 200, got ${vowelHint.response.status}`);
  assert(vowelHint.json?.success === true, `Expected success response from /vowel-hint, got ${JSON.stringify(vowelHint.json)}`);
  assert(vowelHint.json?.usable === false, `Expected non-vowel item to be unusable, got ${JSON.stringify(vowelHint.json)}`);
  assert(vowelHint.json?.reason === 'non_vowel_item', `Expected non_vowel_item reason, got ${JSON.stringify(vowelHint.json)}`);

  const malformedAssess = await postForm(
    `${baseUrl}/api/pronunciation-test/assess`,
    buildAssessForm(createMalformedFmtWav(), 'malformed.wav')
  );
  assert(malformedAssess.response.status === 400, `Expected malformed WAV to return 400, got ${malformedAssess.response.status}`);
  assert(malformedAssess.json?.error === 'INVALID_AUDIO', `Expected malformed WAV to return INVALID_AUDIO, got ${JSON.stringify(malformedAssess.json)}`);
  assert(malformedAssess.json?.details?.reason === 'decode_failed', `Expected malformed WAV to return decode_failed, got ${JSON.stringify(malformedAssess.json)}`);

  const wrongFieldAssess = await postForm(
    `${baseUrl}/api/pronunciation-test/assess`,
    buildAssessForm(shortWav, 'wrong-field.wav', { audioFieldName: 'audioFile' })
  );
  assert(wrongFieldAssess.response.status === 400, `Expected unexpected file field to return 400, got ${wrongFieldAssess.response.status}`);
  assert(wrongFieldAssess.json?.error === 'INVALID_REQUEST', `Expected invalid multipart field to return INVALID_REQUEST, got ${JSON.stringify(wrongFieldAssess.json)}`);
}

async function runMockedSuccessCheck(baseUrl) {
  const validWav = createMonoWav({ sampleRate: 16000, durationMs: 520 });
  const assess = await postForm(`${baseUrl}/api/pronunciation-test/assess`, buildAssessForm(validWav));
  assert(assess.response.ok, `Expected mocked success response, got ${assess.response.status}`);
  assert(assess.json?.success === true, `Expected success response, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.usable === true, `Expected usable assessment, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.targetPhonemeAccuracyScore === 64, `Expected targetPhonemeAccuracyScore=64, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.mostLikelySpokenPhoneme === 't', `Expected spoken phoneme candidate t, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.pairedContrastDetected === true, `Expected pairedContrastDetected=true, got ${JSON.stringify(assess.json)}`);
}

async function runMissingConfigCheck(baseUrl) {
  const validWav = createMonoWav({ sampleRate: 16000, durationMs: 520 });
  const assess = await postForm(`${baseUrl}/api/pronunciation-test/assess`, buildAssessForm(validWav));
  assert(assess.response.status === 500, `Expected missing config to return 500, got ${assess.response.status}`);
  assert(assess.json?.error === 'CONFIG_ERROR', `Expected CONFIG_ERROR, got ${JSON.stringify(assess.json)}`);
}

async function runMockedFinalOmissionCheck(baseUrl) {
  const validWav = createMonoWav({ sampleRate: 16000, durationMs: 520 });
  const assess = await postForm(`${baseUrl}/api/pronunciation-test/assess`, buildAssessForm(validWav, 'tent.wav', {
    itemId: 'core-tent-001',
    word: 'tent',
    referenceText: 'tent',
    referencePhonemes: ['t', '\u025b', 'n', 't'],
    referencePhonemeIndex: 3,
    targetPhoneme: 't',
    contrastPartnerPhoneme: '',
    targetPosition: 'final',
    contrastId: 'final_retention',
    category: 'final-consonant'
  }));
  assert(assess.response.ok, `Expected final omission mock response, got ${assess.response.status}`);
  assert(assess.json?.success === true, `Expected success wrapper for final omission, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.usable === true, `Expected omitted final to stay usable, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.assessmentStatus === 'target_omitted', `Expected target_omitted, got ${JSON.stringify(assess.json)}`);
  assert(assess.json?.targetPhonemeAccuracyScore === 0, `Expected omitted final to score 0, got ${JSON.stringify(assess.json)}`);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const basePort = Number(args.port || process.env.PORT || 8791);

  if (args['start-server']) {
    await withServer(basePort, {}, runRejectAndHintChecks);
    await withServer(basePort + 1, {
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: '',
      PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE: JSON.stringify(buildMockAzurePayload())
    }, runMockedSuccessCheck);
    await withServer(basePort + 2, {
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: '',
      PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE: ''
    }, runMissingConfigCheck);
    await withServer(basePort + 3, {
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: '',
      PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE: JSON.stringify(buildMockFinalOmissionPayload())
    }, runMockedFinalOmissionCheck);
  } else {
    const baseUrl = String(args['base-url'] || `http://127.0.0.1:${basePort}`);
    await runRejectAndHintChecks(baseUrl);
  }

  console.log('Pronunciation test smoke route check passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
