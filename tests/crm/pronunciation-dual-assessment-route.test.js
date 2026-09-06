const assert = require('assert');
const express = require('express');
const http = require('http');
const pronunciationComparisonRouter = require('../../functions/src/routes/pronunciation-comparison');

function makeWavBuffer() {
  const dataSize = 32000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function runTests() {
  const app = express();
  app.use(express.json());
  app.use('/api/pronunciation-assessment', pronunciationComparisonRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/pronunciation-assessment`;

  try {
    // Test 1: POST /option-a with missing audio returns 400
    {
      const res = await fetch(`${baseUrl}/option-a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'record' })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /audio/i);
      console.log('✓ Option A validates missing audio');
    }

    // Test 2: POST /option-a with missing word returns 400
    {
      const formData = new FormData();
      const wav = makeWavBuffer();
      formData.append('audio', new Blob([wav], { type: 'audio/wav' }), 'test.wav');

      const res = await fetch(`${baseUrl}/option-a`, {
        method: 'POST',
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /word/i);
      console.log('✓ Option A validates missing word');
    }

    // Test 3: POST /option-a with valid input and mock Azure response
    {
      process.env.PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE = JSON.stringify({
        RecognitionStatus: 'Success',
        NBest: [{
          Confidence: 0.96,
          AccuracyScore: 92,
          FluencyScore: 89,
          CompletenessScore: 100,
          Words: [{
            Word: 'photograph',
            Offset: 1000000,
            Duration: 8000000,
            Phonemes: [
              { Phoneme: 'f', Offset: 1000000, Duration: 1000000, PronunciationAssessment: { AccuracyScore: 95 } },
              { Phoneme: 'oʊ', Offset: 2000000, Duration: 2000000, PronunciationAssessment: { AccuracyScore: 92 } },
              { Phoneme: 't', Offset: 4000000, Duration: 800000, PronunciationAssessment: { AccuracyScore: 90 } },
              { Phoneme: 'ə', Offset: 4800000, Duration: 1200000, PronunciationAssessment: { AccuracyScore: 88 } },
              { Phoneme: 'ɡ', Offset: 6000000, Duration: 800000, PronunciationAssessment: { AccuracyScore: 94 } },
              { Phoneme: 'r', Offset: 6800000, Duration: 600000, PronunciationAssessment: { AccuracyScore: 90 } },
              { Phoneme: 'æ', Offset: 7400000, Duration: 1200000, PronunciationAssessment: { AccuracyScore: 89 } },
              { Phoneme: 'f', Offset: 8600000, Duration: 400000, PronunciationAssessment: { AccuracyScore: 93 } }
            ]
          }]
        }]
      });

      const formData = new FormData();
      const wav = makeWavBuffer();
      formData.append('audio', new Blob([wav], { type: 'audio/wav' }), 'test.wav');
      formData.append('word', 'photograph');
      formData.append('reference_ipa', 'ˈfoʊ.tə.ɡræf');

      const res = await fetch(`${baseUrl}/option-a`, {
        method: 'POST',
        body: formData
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.engine, 'option-a');
      assert.strictEqual(data.targetWord, 'photograph');
      assert.ok(Array.isArray(data.syllables));
      assert.strictEqual(data.syllables.length, 3); // /oʊ/, /ə/, /æ/
      assert.strictEqual(data.syllables[0].nucleusPhoneme, 'oʊ');
      assert.strictEqual(data.syllables[1].nucleusPhoneme, 'ə');
      assert.strictEqual(data.syllables[2].nucleusPhoneme, 'æ');
      // Verify /ə/ reduction detection
      assert.ok(data.reductionChecks);
      assert.strictEqual(data.reductionChecks[1].isReduced, true);
      assert.match(data.reductionChecks[1].verdict, /reduction/i);
      // Verify stress prominence
      assert.strictEqual(typeof data.detectedStressedIndex, 'number');
      assert.strictEqual(typeof data.summary.stressConfidence, 'number');
      console.log('✓ Option A extracts vowel nuclei, checks /ə/ reduction, and computes prominence');
    }

    // Test 4: POST /option-b with missing audio returns 400
    {
      const res = await fetch(`${baseUrl}/option-b`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'record' })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /audio/i);
      console.log('✓ Option B validates missing audio');
    }

    // Test 5: POST /option-b proxy with mocked backend response
    {
      const mockBackendServer = http.createServer((req, res) => {
        if (req.url === '/analyze/option-b' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            engine: 'option-b',
            targetWord: 'record',
            syllables: [
              { syllable: 1, startTime: 0.1, endTime: 0.3, vowelDuration: 0.15, prominence: 0.9 },
              { syllable: 2, startTime: 0.35, endTime: 0.55, vowelDuration: 0.10, prominence: 0.4 }
            ]
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      await new Promise((resolve) => mockBackendServer.listen(0, resolve));
      const mockPort = mockBackendServer.address().port;
      const mockBackendUrl = `http://127.0.0.1:${mockPort}`;

      try {
        const formData = new FormData();
        const wav = makeWavBuffer();
        formData.append('audio', new Blob([wav], { type: 'audio/wav' }), 'test.wav');
        formData.append('word', 'record');
        formData.append('reference_ipa', 'ˈrɛk.ɚd');

        const res = await fetch(`${baseUrl}/option-b`, {
          method: 'POST',
          body: formData,
          headers: { 'x-python-backend-url': mockBackendUrl }
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.engine, 'option-b');
        assert.strictEqual(data.syllables.length, 2);
        console.log('✓ Option B successfully proxies to Python backend');
      } finally {
        await new Promise((resolve) => mockBackendServer.close(resolve));
      }
    }
  } finally {
    delete process.env.PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE;
    await new Promise((resolve) => server.close(resolve));
  }
}

runTests().then(() => {
  console.log('All pronunciation dual assessment route tests passed!');
}).catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
