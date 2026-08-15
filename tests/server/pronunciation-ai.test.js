const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const pronunciationAiRouter = require('../../src/routes/pronunciation-ai');
const {
  buildPrompt,
  cleanGeneratedSummary,
  generateAiSummary
} = pronunciationAiRouter;

test('Pronunciation AI - buildPrompt', () => {
  const comparison = {
    overallScore: 85,
    pitchScore: 80,
    durationScore: 88,
    intensityScore: 78,
    stressMatches: true,
    syllableCountMatches: true
  };
  const userSyllables = [
    { duration: 0.18, maxPitch: 145 },
    { duration: 0.22, maxPitch: 160 }
  ];

  const prompt = buildPrompt('banana', comparison, userSyllables, 'bəˈnænə');
  assert.ok(prompt.includes('banana'));
  assert.ok(prompt.includes('bəˈnænə'));
  assert.ok(prompt.includes('Overall: 85%'));
  assert.ok(prompt.includes('Pitch accuracy: 80%'));
  assert.ok(prompt.includes('Syllable 1: duration=0.180s, pitch=145Hz'));
  assert.ok(prompt.includes('Keep it under 60 words'));
});

test('Pronunciation AI - cleanGeneratedSummary', () => {
  const dirty = '## **Great job!** *Keep* your pitch steady and **strong**.';
  const clean = cleanGeneratedSummary(dirty);
  assert.equal(clean, 'Great job! Keep your pitch steady and strong.');
});

test('Pronunciation AI - generateAiSummary with custom mock model', async () => {
  const mockModel = {
    generateContent: async () => ({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: '**Nice effort!** Your rhythm was solid, but watch syllable stress.' }]
            }
          }
        ]
      }
    })
  };

  const result = await generateAiSummary('test prompt', { modelOverride: mockModel });
  assert.equal(result.source, 'vertex-ai');
  assert.equal(result.summary, 'Nice effort! Your rhythm was solid, but watch syllable stress.');
});

test('Pronunciation AI - Express route /api/pronunciation-ai/summary', async () => {
  process.env.FIREBASE_PROJECT_ID = 'listening-tasks-3ae34';
  const app = express();
  app.use(express.json());
  app.use('/api', pronunciationAiRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Missing fields should return 400
    const badRes = await fetch(`${baseUrl}/api/pronunciation-ai/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'test' })
    });
    assert.equal(badRes.status, 400);
    const badData = await badRes.json();
    assert.equal(badData.success, false);
    assert.equal(badData.error, 'INVALID_INPUT');

    // 2. Valid request structure handled without throwing server crash
    const res = await fetch(`${baseUrl}/api/pronunciation-ai/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'photograph',
        comparison: {
          overallScore: 78,
          pitchScore: 75,
          durationScore: 82,
          intensityScore: 77,
          stressMatches: true,
          syllableCountMatches: true
        },
        userSyllables: [
          { duration: 0.15, maxPitch: 180 },
          { duration: 0.12, maxPitch: 160 },
          { duration: 0.20, maxPitch: 140 }
        ],
        ipa: 'ˈfoʊ.tə.ɡræf'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.source !== undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
