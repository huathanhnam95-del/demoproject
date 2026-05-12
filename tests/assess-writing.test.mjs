import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'test-project';
const {
  buildModelPrompt,
  extractJsonObject,
  extractVertexText
} = require('../functions/src/assessWriting.helpers.js');

console.log('Starting assessWriting helper tests...');

const phrasePrompt = buildModelPrompt('The golden apple looks rare.', {
  entryType: 'word',
  word: 'apple',
  lemma: 'apple',
  partOfSpeech: 'noun',
  promptText: 'Write a sentence using "golden apple".',
  usedCollocation: 'golden apple',
  validationTarget: 'golden apple'
});
assert.match(phrasePrompt, /Task shown to learner: Write a sentence using "golden apple"\./);
assert.match(phrasePrompt, /Selected collocation: golden apple/);
assert.match(phrasePrompt, /Required target: golden apple/);

const parsed = extractJsonObject('prelude {"score":88,"feedback":"Strong","corrections":[]} trailer');
assert.deepEqual(parsed, {
  score: 88,
  feedback: 'Strong',
  corrections: []
});

assert.throws(() => extractJsonObject('not-json-at-all'), /No JSON object found/);

const vertexTextFromCandidates = extractVertexText({
  candidates: [
    {
      content: {
        parts: [
          { text: '{"score":77,' },
          { text: '"feedback":"Good","corrections":[]}' }
        ]
      }
    }
  ]
});
assert.equal(vertexTextFromCandidates, '{"score":77,"feedback":"Good","corrections":[]}');

assert.throws(
  () => extractVertexText({ candidates: [] }),
  /No text found in Vertex AI response/
);

async function runAssessWritingWithStubs({
  userDocExists = false,
  userData = {},
  generatedText = '{"score":91,"feedback":"OK","corrections":[]}',
  generateThrows = null
} = {}) {
  const originalLoad = Module._load;
  const calls = { get: 0, set: 0, generate: 0 };

  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  Module._load = function(request, parent, isMain) {
    if (request === 'firebase-functions/v2/https') {
      return {
        onCall: (_opts, handler) => handler,
        HttpsError
      };
    }

    if (request === '@google/genai') {
      return {
        GoogleGenAI: class {
          constructor() {
            this.models = {
              generateContent: async () => {
                  calls.generate += 1;
                  if (generateThrows) {
                    throw generateThrows;
                  }
                  return { text: generatedText };
              }
            };
          }
        }
      };
    }

    if (request === 'firebase-admin') {
      return {
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => {
                calls.get += 1;
                return {
                  exists: userDocExists,
                  data: () => (userDocExists ? userData : undefined)
                };
              },
              set: async () => {
                calls.set += 1;
              }
            })
          })
        })
      };
    }

    return originalLoad(request, parent, isMain);
  };

  const modulePath = require.resolve('../functions/src/assessWriting.js');
  const geminiModelsPath = require.resolve('../functions/src/geminiVertexModels.js');
  delete require.cache[modulePath];
  delete require.cache[geminiModelsPath];

  try {
    const { assessWriting } = require('../functions/src/assessWriting.js');
    return { assessWriting, calls, HttpsError };
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    delete require.cache[geminiModelsPath];
  }
}

const missingDocHarness = await runAssessWritingWithStubs({ userDocExists: false });
const missingDocResult = await missingDocHarness.assessWriting({
  auth: { uid: 'user-123' },
  data: {
    text: 'The golden apple was on the table.',
    context: {
      challengeId: 'ch1',
      contextId: 'ctx1',
      entryType: 'phrase',
      wordObj: { lemma: 'apple', originalWord: 'apple', partOfSpeech: 'noun' },
      promptText: 'Write a sentence using "golden apple".',
      usedCollocation: 'golden apple',
      validationTarget: 'golden apple'
    }
  }
});
assert.deepEqual(missingDocResult, {
  success: true,
  score: 91,
  feedback: 'OK',
  corrections: []
});
assert.deepEqual(missingDocHarness.calls, { get: 1, set: 1, generate: 1 });

const providerFailureHarness = await runAssessWritingWithStubs({
  userDocExists: true,
  userData: { aiWritingStats: { lastDate: '2026-03-27', count: 0 } },
  generateThrows: new Error('provider exploded')
});
await assert.rejects(
  providerFailureHarness.assessWriting({
    auth: { uid: 'user-456' },
    data: {
      text: 'The golden apple was on the table.',
      context: {
        challengeId: 'ch2',
        contextId: 'ctx2',
        entryType: 'phrase',
        wordObj: { lemma: 'apple', originalWord: 'apple', partOfSpeech: 'noun' },
        promptText: 'Write a sentence using "golden apple".',
        usedCollocation: 'golden apple',
        validationTarget: 'golden apple'
      }
    }
  }),
  (error) => error.code === 'internal' && /AI analysis failed/.test(error.message)
);
assert.deepEqual(providerFailureHarness.calls, { get: 1, set: 0, generate: 1 });

console.log('assessWriting helper tests passed');
