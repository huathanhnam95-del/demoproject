/**
 * Reading Journey advance route regression tests
 * Run with: node tests/reading-journey-advance-route.test.js
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

console.log('Starting Reading Journey advance route tests...');

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

  const outlineId = 'outline-advance-test';
  const cacheRecords = new Map();

  function beatId(beatNumber, pathItems) {
    return `beat|${outlineId}|${beatNumber}|${(pathItems || []).join(',')}`;
  }

  cacheRecords.set(outlineId, {
    formatVersion: 2,
    title: 'A Trip to Remember',
    beatOutline: [
      { beat: 1, milestone: 'Mai arrives.' },
      { beat: 2, milestone: 'Mai makes a choice.' }
    ]
  });

  cacheRecords.set(beatId(1, []), {
    formatVersion: 2,
    questionType: 'mcq',
    segment: 'Mai stepped off the bus and walked toward a community learning center in the early morning while the sky stayed bright blue and the heavy chain on the front door made her pause and rethink her first plan for the day ahead.',
    recap: 'Mai arrives at a locked building.',
    shouldEnd: false,
    choiceQuestion: {
      question: 'What should Mai do next?',
      options: [
        { id: 'investigate', label: 'Look around for clues.' },
        { id: 'ask', label: 'Ask someone nearby for help.' },
        { id: 'wait', label: 'Wait and watch the entrance.' }
      ]
    },
    highlights: ['bus', 'chain', 'door']
  });

  const cacheStub = {
    normalizeKeywords: (value) => value,
    resolveTtlMs: () => 86_400_000,
    computeKeywordTagsCacheKey: () => ({ id: 'unused-keywords' }),
    computeOutlineCacheKey: () => ({ id: outlineId, normalizedTopicTags: [], key: 'unused-outline' }),
    computeBeatCacheKey: ({ outlineId: incomingOutlineId, beatNumber, path: incomingPath }) => ({
      id: `beat|${incomingOutlineId}|${beatNumber}|${(incomingPath || []).join(',')}`,
      key: `beat-key|${incomingOutlineId}|${beatNumber}|${(incomingPath || []).join(',')}`
    }),
    getCachedValue: async ({ id }) => cacheRecords.get(id) || null,
    setCachedValue: async ({ id, value }) => {
      cacheRecords.set(id, value);
      return {};
    },
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
    generateTopicTags: async () => ['travel'],
    generateOutline: async () => cacheRecords.get(outlineId),
    generateBeat: async ({ beatNumber, questionType, choiceIds }) => {
      if (questionType === 'open') {
        return {
          formatVersion: 2,
          questionType: 'open',
          segment: 'Mai listened carefully to the guard and then wrote a calm explanation about why the locked building mattered to her schedule, which helped her organize the next step before anyone else arrived that morning.',
          recap: 'Mai explains the situation clearly.',
          shouldEnd: false,
          productionPrompt: { question: 'What would Mai say next?' },
          highlights: ['guard', 'explanation', 'schedule']
        };
      }
      return {
        formatVersion: 2,
        questionType: 'mcq',
        segment: 'Mai spotted a guard at the side gate and politely explained why she had come so early, which gave her a better chance to learn what had happened before the rest of the group arrived at the center together.',
        recap: 'Mai asks a guard for help.',
        shouldEnd: false,
        choiceQuestion: {
          question: 'What should she do now?',
          options: (choiceIds || ['investigate', 'ask']).map((id) => ({
            id,
            label: `Choose ${id}.`
          }))
        },
        highlights: ['guard', 'gate', 'group'],
        beatNumber
      };
    },
    assessAndScore: async () => {
      throw new Error('assessAndScore should not be called in advance route test');
    }
  };

  mockModule(cachePath, cacheStub);
  mockModule(geminiPath, geminiStub);
  mockModule(builderPath, { buildAssessmentQuiz: async () => ({}) });
  mockModule(limiterPath, (_req, _res, next) => next());
  delete require.cache[routePath];

  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const { server, baseUrl } = await startServer(app);

  try {
    const legacyPathPayload = await fetch(`${baseUrl}/api/reading-journey/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outlineId,
        currentBeatNumber: 1,
        path: ['ask'],
        choiceId: 'ask',
        level: 'B1'
      })
    });
    const legacyPathJson = await legacyPathPayload.json();

    assert.strictEqual(
      legacyPathPayload.status,
      200,
      'advance route should accept legacy payloads where path already includes the selected choice'
    );
    assert.strictEqual(legacyPathJson.success, true, 'legacy payload should still succeed');
    assert.strictEqual(legacyPathJson.beat?.beatNumber, 2, 'advance route should return beat 2');
    assert.deepStrictEqual(
      legacyPathJson.beat?.path,
      ['ask'],
      'advance route should preserve the canonical path after normalizing the legacy payload'
    );
  } finally {
    await stopServer(server);
    if (originalRoute) require.cache[routePath] = originalRoute; else delete require.cache[routePath];
    if (originalCache) require.cache[cachePath] = originalCache; else delete require.cache[cachePath];
    if (originalGemini) require.cache[geminiPath] = originalGemini; else delete require.cache[geminiPath];
    if (originalBuilder) require.cache[builderPath] = originalBuilder; else delete require.cache[builderPath];
    if (originalLimiter) require.cache[limiterPath] = originalLimiter; else delete require.cache[limiterPath];
  }

  console.log('Reading Journey advance route passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
