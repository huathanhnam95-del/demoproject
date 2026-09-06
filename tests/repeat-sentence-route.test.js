/* eslint-disable no-console */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const express = require('express');
const http = require('http');

function createMonoPcmWavBuffer({ sampleRate = 16000, durationMs = 300 } = {}) {
  const bytesPerSample = 2;
  const numChannels = 1;
  const totalSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const dataSize = totalSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
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

function buildMultipartBody(fields = {}, files = {}) {
  const boundary = '--------------------------boundary_' + Math.random().toString(16).slice(2);
  const chunks = [];

  Object.entries(fields).forEach(([key, value]) => {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${value}\r\n`
    ));
  });

  Object.entries(files).forEach(([fieldName, file]) => {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${file.filename || 'audio.wav'}"\r\n` +
      `Content-Type: ${file.contentType || 'audio/wav'}\r\n\r\n`
    ));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  });

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks)
  };
}

async function postAssessment(baseUrl, { audioBuffer, referenceText, questionId } = {}) {
  const fields = {};
  if (referenceText !== undefined) fields.referenceText = referenceText;
  if (questionId !== undefined) fields.questionId = questionId;

  const files = {};
  if (audioBuffer) {
    files.audio = {
      filename: 'student.wav',
      contentType: 'audio/wav',
      buffer: audioBuffer
    };
  }

  const { contentType, body } = buildMultipartBody(fields, files);

  const response = await fetch(`${baseUrl}/api/repeat-sentence/assess`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType
    },
    body
  });

  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function runTests() {
  console.log('[Test] Running Repeat Sentence route tests...');

  const repeatSentenceRouter = require('../functions/src/routes/repeat-sentence');
  const app = express();
  app.use('/api', repeatSentenceRouter);

  const { server, baseUrl } = await startServer(app);

  try {
    // 1. Missing audio
    {
      const { response, payload } = await postAssessment(baseUrl, {
        referenceText: 'The library is open on weekends.'
      });
      assert.strictEqual(response.status, 400);
      assert.strictEqual(payload.error, 'INVALID_INPUT');
      console.log('✔ Rejects request without audio');
    }

    // 2. Missing referenceText
    {
      const { response, payload } = await postAssessment(baseUrl, {
        audioBuffer: createMonoPcmWavBuffer()
      });
      assert.strictEqual(response.status, 400);
      assert.strictEqual(payload.error, 'INVALID_INPUT');
      console.log('✔ Rejects request without referenceText');
    }

    // 3. Corrupt audio buffer
    {
      const { response, payload } = await postAssessment(baseUrl, {
        audioBuffer: Buffer.from('not a wav file'),
        referenceText: 'The library is open on weekends.'
      });
      assert.strictEqual(response.status, 422);
      assert.strictEqual(payload.error, 'INVALID_AUDIO');
      console.log('✔ Rejects corrupt audio with 422 INVALID_AUDIO');
    }

    // 4. Successful mock assessment with syllables & phoneme substitutions
    {
      process.env.REPEAT_SENTENCE_AZURE_MOCK_RESPONSE = JSON.stringify({
        RecognitionStatus: 'Success',
        NBest: [{
          Display: 'The library is open on weekends.',
          PronunciationAssessment: {
            AccuracyScore: 88,
            FluencyScore: 84,
            CompletenessScore: 100,
            PronScore: 86
          },
          Words: [
            {
              Word: 'The',
              Offset: 1000000,
              Duration: 2000000,
              PronunciationAssessment: { AccuracyScore: 92, ErrorType: 'None' },
              Syllables: [
                {
                  Syllable: 'ðə',
                  Offset: 1000000,
                  Duration: 2000000,
                  PronunciationAssessment: { AccuracyScore: 92 }
                }
              ],
              Phonemes: [
                {
                  Phoneme: 'ð',
                  Offset: 1000000,
                  Duration: 800000,
                  PronunciationAssessment: { AccuracyScore: 92 }
                },
                {
                  Phoneme: 'ə',
                  Offset: 1800000,
                  Duration: 1200000,
                  PronunciationAssessment: { AccuracyScore: 92 }
                }
              ]
            },
            {
              Word: 'library',
              Offset: 3100000,
              Duration: 6000000,
              PronunciationAssessment: { AccuracyScore: 78, ErrorType: 'None' },
              Syllables: [
                {
                  Syllable: 'laɪ',
                  Grapheme: 'li',
                  Offset: 3100000,
                  Duration: 2500000,
                  PronunciationAssessment: { AccuracyScore: 85 }
                },
                {
                  Syllable: 'brər',
                  Grapheme: 'brar',
                  Offset: 5600000,
                  Duration: 2000000,
                  PronunciationAssessment: { AccuracyScore: 65 }
                },
                {
                  Syllable: 'i',
                  Grapheme: 'y',
                  Offset: 7600000,
                  Duration: 1500000,
                  PronunciationAssessment: { AccuracyScore: 82 }
                }
              ],
              Phonemes: [
                {
                  Phoneme: 'l',
                  Offset: 3100000,
                  Duration: 1000000,
                  PronunciationAssessment: { AccuracyScore: 88 }
                },
                {
                  Phoneme: 'aɪ',
                  Offset: 4100000,
                  Duration: 1500000,
                  PronunciationAssessment: { AccuracyScore: 82 }
                },
                {
                  Phoneme: 'b',
                  Offset: 5600000,
                  Duration: 800000,
                  PronunciationAssessment: { AccuracyScore: 85 }
                },
                {
                  Phoneme: 'ɹ',
                  Offset: 6400000,
                  Duration: 1200000,
                  PronunciationAssessment: { AccuracyScore: 50 },
                  NBestPhonemes: [{ Phoneme: 'l' }]
                },
                {
                  Phoneme: 'i',
                  Offset: 7600000,
                  Duration: 1500000,
                  PronunciationAssessment: { AccuracyScore: 82 }
                }
              ]
            }
          ]
        }]
      });

      const { response, payload } = await postAssessment(baseUrl, {
        audioBuffer: createMonoPcmWavBuffer({ durationMs: 950 }),
        referenceText: 'The library is open on weekends.',
        questionId: 'q-rs-001'
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(payload.success, true);
      assert.strictEqual(payload.accuracyScore, 88);
      assert.strictEqual(payload.words.length, 2);

      const theWord = payload.words[0];
      assert.strictEqual(theWord.word, 'The');
      assert.strictEqual(theWord.accuracyScore, 92);
      assert.strictEqual(theWord.startMs, 100);
      assert.strictEqual(theWord.endMs, 300);
      assert.ok(Array.isArray(theWord.syllables));
      assert.strictEqual(theWord.syllables.length, 1);
      assert.strictEqual(theWord.syllables[0].text, 'ðə');

      const libWord = payload.words[1];
      assert.strictEqual(libWord.word, 'library');
      assert.strictEqual(libWord.accuracyScore, 78);
      assert.strictEqual(libWord.syllables.length, 3);

      const midSyl = libWord.syllables[1];
      assert.strictEqual(midSyl.text, 'brar');
      assert.strictEqual(midSyl.accuracyScore, 65);
      // Verify Oxford American IPA conversion (ɹ -> r, turned r)
      assert.strictEqual(midSyl.ipa, 'brər');
      // Substituted /r/ with /l/ should generate coaching tip
      assert.ok(midSyl.heardIpa, 'heardIpa should be detected for substituted /r/');
      assert.ok(midSyl.tip, 'tip should be generated for /r/ -> /l/ substitution');

      console.log('✔ Returns rich multi-syllabic breakdown, Oxford IPA, and articulatory coaching tips');
    }

    // 5. Verify forced-alignment assessment header contract
    {
      const { buildPronunciationAssessmentHeader } = require('../functions/src/services/pronunciation-assessment-service');
      const headerBase64 = buildPronunciationAssessmentHeader('The library is open on weekends.');
      const parsedConfig = JSON.parse(Buffer.from(headerBase64, 'base64').toString('utf8'));
      assert.strictEqual(parsedConfig.Dimension, 'Comprehensive');
      assert.strictEqual(parsedConfig.Granularity, 'Phoneme');
      assert.strictEqual(parsedConfig.NBestPhonemeCount, 5);
      console.log('✔ Builds canonical forced-alignment header with Comprehensive dimension and Phoneme granularity');
    }
  } finally {
    delete process.env.REPEAT_SENTENCE_AZURE_MOCK_RESPONSE;
    await stopServer(server);
  }

  console.log('Repeat Sentence route tests passed successfully!');
}

runTests().catch((err) => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});
