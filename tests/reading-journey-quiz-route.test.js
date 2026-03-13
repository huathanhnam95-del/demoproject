/**
 * Reading Journey quiz route tests
 * Run with: node tests/reading-journey-quiz-route.test.js
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

console.log('Starting Reading Journey quiz route tests...');

function mockModule(modulePath, exportsValue) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue
  };
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

(async () => {
  process.env.READING_JOURNEY_ENABLED = 'true';
  process.env.READING_JOURNEY_ALLOW_REMOTE = 'true';

  const root = process.cwd();
  const routePath = require.resolve(path.join(root, 'src/routes/reading-journey.js'));
  const cachePath = require.resolve(path.join(root, 'src/services/reading-journey/cache.js'));
  const geminiPath = require.resolve(path.join(root, 'src/services/reading-journey/gemini.js'));
  const builderPath = require.resolve(path.join(root, 'src/services/reading-journey/quiz-builder.js'));
  const limiterPath = require.resolve(path.join(root, 'src/middleware/rate-limiter.js'));

  const originalRoute = require.cache[routePath];
  const originalCache = require.cache[cachePath];
  const originalGemini = require.cache[geminiPath];
  const originalBuilder = require.cache[builderPath];
  const originalLimiter = require.cache[limiterPath];

  const outlineId = 'outline-quiz-test';
  const completedPath = ['investigate', 'ask', 'wait', 'investigate', 'ask'];
  const cacheRecords = new Map();

  function beatId(beatNumber, pathItems) {
    return `beat|${outlineId}|${beatNumber}|${(pathItems || []).join(',')}`;
  }

  cacheRecords.set(outlineId, {
    formatVersion: 2,
    title: 'A Quiet Surprise',
    beatOutline: [
      { beat: 1, milestone: 'Maya finds a note.' },
      { beat: 2, milestone: 'She studies the clue.' },
      { beat: 3, milestone: 'She asks Leo for help.' },
      { beat: 4, milestone: 'They find an envelope.' },
      { beat: 5, milestone: 'They learn the surprise is kind.' }
    ]
  });

  for (let beat = 1; beat <= 5; beat += 1) {
    const slice = completedPath.slice(0, Math.max(0, beat - 1));
    cacheRecords.set(beatId(beat, slice), {
      formatVersion: 2,
      questionType: beat === 2 || beat === 4 ? 'open' : 'mcq',
      segment: `Beat ${beat} segment with enough story detail to test canonical reconstruction and ensure the router reads from cache instead of the request payload for its final quiz generation path in this hidden prototype flow.`,
      recap: `Beat ${beat} recap`,
      shouldEnd: false,
      choiceQuestion: beat === 2 || beat === 4 ? null : {
        question: 'What do you do next?',
        options: [
          { id: 'investigate', label: 'Investigate the clue carefully.' },
          { id: 'ask', label: 'Ask Leo for help.' },
          { id: 'wait', label: 'Wait and observe quietly.' }
        ]
      },
      productionPrompt: beat === 2 || beat === 4 ? { question: 'Explain your choice.' } : null,
      highlights: ['note', 'clue', 'envelope']
    });
  }

  cacheRecords.set(beatId(6, completedPath), {
    formatVersion: 2,
    questionType: 'end',
    segment: 'Final ending beat segment with enough words to satisfy the canonical story reconstruction logic before the assessment quiz is requested from the backend route for this completed story path today.',
    recap: 'Ending recap',
    shouldEnd: true,
    endWrap: 'Maya leaves the library smiling because the mystery turned out to be a kind thank-you for her quiet honesty and help.'
  });

  const cacheStub = {
    normalizeKeywords: (value) => value,
    resolveTtlMs: () => 86_400_000,
    computeKeywordTagsCacheKey: () => ({ id: 'unused-keywords' }),
    computeOutlineCacheKey: () => ({ id: outlineId, normalizedTopicTags: [], key: 'unused-outline' }),
    computeBeatCacheKey: ({ outlineId: incomingOutlineId, beatNumber, path: incomingPath }) => ({
      id: `beat|${incomingOutlineId}|${beatNumber}|${(incomingPath || []).join(',')}`,
      key: 'unused-beat'
    }),
    getCachedValue: async ({ id }) => cacheRecords.get(id) || null,
    setCachedValue: async () => ({}),
    listCachedOutlines: async () => []
  };

  const geminiStub = {
    normalizeLevel: (level) => {
      const value = String(level || '').trim().toUpperCase();
      return ['A2', 'B1', 'B2', 'C1'].includes(value) ? value : 'B1';
    },
    getModelName: () => 'test-model',
    getEffectiveModelName: () => 'test-model',
    getFallbackModelName: () => 'test-fallback',
    getForceFallbackReason: () => '',
    generateTopicTags: async () => ['mystery', 'friendship', 'school'],
    generateOutline: async () => cacheRecords.get(outlineId),
    generateBeat: async () => {
      throw new Error('generateBeat should not be called in quiz route test');
    },
    assessAndScore: async () => {
      throw new Error('assessAndScore should not be called in quiz route test');
    }
  };

  const builderCalls = [];
  const builderStub = {
    buildAssessmentQuiz: async (payload) => {
      builderCalls.push(payload);
      return {
        quizId: 'quiz-1',
        outlineId: payload.outlineId,
        level: payload.level,
        storySnapshot: {
          title: 'A Quiet Surprise',
          paragraphs: payload.segments.map((segment, index) => ({
            id: `p${index + 1}`,
            text: segment,
            sentences: [{ id: `p${index + 1}s1`, text: segment }]
          }))
        },
        questions: [
          {
            id: 'q1',
            type: 'mcq_main_idea',
            skill: 'comprehension',
            prompt: 'What is the main idea?',
            options: [
              { id: 'a', text: 'Correct answer' },
              { id: 'b', text: 'Wrong answer' }
            ],
            correctOptionId: 'a'
          },
          {
            id: 'q2',
            type: 'click_word_meaning',
            skill: 'vocabulary',
            prompt: 'Click the word that means message.',
            target: { word: 'note', paragraphIndex: 0, acceptedSurfaceForms: ['note'] }
          },
          {
            id: 'q3',
            type: 'tap_evidence',
            skill: 'comprehension',
            prompt: 'Tap the evidence.',
            target: { paragraphIndex: 1, evidenceAnchors: ['thank-you'] }
          },
          {
            id: 'q4',
            type: 'sequence_events',
            skill: 'comprehension',
            prompt: 'Order the events.',
            items: [
              { id: 'a', text: 'One' },
              { id: 'b', text: 'Two' }
            ],
            correctOrder: ['a', 'b']
          },
          {
            id: 'q5',
            type: 'short_answer',
            skill: 'comprehension',
            prompt: 'Why did Maya smile?',
            rubric: { focus: 'ending', requireEvidence: false },
            idealAnswers: ['Because she felt appreciated.']
          }
        ]
      };
    }
  };

  mockModule(cachePath, cacheStub);
  mockModule(geminiPath, geminiStub);
  mockModule(builderPath, builderStub);
  mockModule(limiterPath, (_req, _res, next) => next());
  delete require.cache[routePath];

  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const { server, baseUrl } = await startServer(app);

  try {
    const missingOutline = await fetch(`${baseUrl}/api/reading-journey/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: completedPath, level: 'B1' })
    });
    const missingOutlineJson = await missingOutline.json();
    assert.strictEqual(missingOutline.status, 400, 'quiz route should require outlineId');
    assert.strictEqual(missingOutlineJson.error, 'INVALID_ARGUMENT', 'missing outlineId should return INVALID_ARGUMENT');

    const incompletePath = await fetch(`${baseUrl}/api/reading-journey/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outlineId, path: completedPath.slice(0, 4), level: 'B1' })
    });
    const incompletePathJson = await incompletePath.json();
    assert.strictEqual(incompletePath.status, 400, 'quiz route should reject incomplete paths');
    assert.match(incompletePathJson.message, /completed path/i, 'incomplete path error should explain completion requirement');

    const endingBeatKey = beatId(6, completedPath);
    const endingBeat = cacheRecords.get(endingBeatKey);
    cacheRecords.delete(endingBeatKey);
    const missingEnding = await fetch(`${baseUrl}/api/reading-journey/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outlineId, path: completedPath, level: 'B1' })
    });
    const missingEndingJson = await missingEnding.json();
    assert.strictEqual(missingEnding.status, 400, 'quiz route should reject stories without the ending beat');
    assert.strictEqual(missingEndingJson.error, 'NOT_FOUND', 'missing ending beat should return NOT_FOUND');
    cacheRecords.set(endingBeatKey, endingBeat);

    const success = await fetch(`${baseUrl}/api/reading-journey/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outlineId,
        path: completedPath,
        level: 'B1',
        history: ['browser supplied history should be ignored'],
        storyText: 'browser supplied story should be ignored'
      })
    });
    const successJson = await success.json();
    assert.strictEqual(success.status, 200, 'quiz route should return success for completed stories');
    assert.strictEqual(successJson.success, true, 'successful quiz route should set success=true');
    assert.ok(successJson.storySnapshot, 'quiz route should return storySnapshot');
    assert.strictEqual(successJson.questions.length, 5, 'quiz route should return five questions');
    assert.strictEqual(successJson.quizId, 'quiz-1', 'quiz route should return the builder quiz id');
    assert.strictEqual(successJson.recommendedReviewCount, 2, 'quiz route should return a review count derived from question skills');

    assert.strictEqual(builderCalls.length, 1, 'quiz builder should be called exactly once for the successful request');
    assert.strictEqual(builderCalls[0].outlineId, outlineId, 'quiz builder should receive the outline id');
    assert.strictEqual(builderCalls[0].segments.length, 5, 'quiz builder should receive canonical story segments from cache');
    assert.ok(
      builderCalls[0].segments.every((segment) => !segment.includes('browser supplied')),
      'quiz route should ignore browser-supplied transcript/story text and rebuild from cache'
    );
    assert.match(
      builderCalls[0].endWrap,
      /quiet honesty/i,
      'quiz route should pass the ending wrap from the cached final beat'
    );
  } finally {
    await stopServer(server);
    if (originalRoute) require.cache[routePath] = originalRoute; else delete require.cache[routePath];
    if (originalCache) require.cache[cachePath] = originalCache; else delete require.cache[cachePath];
    if (originalGemini) require.cache[geminiPath] = originalGemini; else delete require.cache[geminiPath];
    if (originalBuilder) require.cache[builderPath] = originalBuilder; else delete require.cache[builderPath];
    if (originalLimiter) require.cache[limiterPath] = originalLimiter; else delete require.cache[limiterPath];
  }

  console.log('Reading Journey quiz route passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
