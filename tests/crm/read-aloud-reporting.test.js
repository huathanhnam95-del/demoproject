/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function buildRes() {
  return {
    _status: 200,
    _json: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(payload) {
      this._json = payload;
      return this;
    }
  };
}

function getRouteHandlers(router, routePath, method) {
  const layer = (router.stack || []).find((entry) => entry.route && entry.route.path === routePath);
  assert(layer, `Route ${routePath} not found`);
  return (layer.route.stack || [])
    .filter((stack) => stack.method === method)
    .map((stack) => stack.handle);
}

async function invokeHandlers(handlers, req, res) {
  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      if (handler.length >= 3) {
        handler(req, res, (error) => (error ? reject(error) : resolve()));
        return;
      }
      Promise.resolve(handler(req, res)).then(resolve, reject);
    });
  }
}

function createMockAttemptCollection(attempts) {
  const rows = attempts.slice();
  return {
    where(_field, _op, value) {
      return {
        async get() {
          const docs = rows.filter((attempt) => {
            const createdAt = attempt.createdAt instanceof Date ? attempt.createdAt : new Date(attempt.createdAt);
            return createdAt >= value;
          }).map((attempt, index) => ({
            id: attempt.attemptId || `attempt-${index}`,
            data: () => attempt
          }));
          return { docs };
        }
      };
    },
    async get() {
      return {
        docs: rows.map((attempt, index) => ({
          id: attempt.attemptId || `attempt-${index}`,
          data: () => attempt
        }))
      };
    }
  };
}

(async () => {
  const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-aloud-reporting-'));
  const indexPath = path.join(tempDir, 'connected-speech-index.json');
  fs.writeFileSync(indexPath, JSON.stringify({
    indexVersion: '9',
    generatedAt: '2026-03-26T00:00:00.000Z',
    prompts: [
      {
        rowKey: 'id:1',
        questionId: '1',
        title: 'Prompt 1',
        hasSampleAudio: true,
        hasAnyConnectedSpeech: true,
        hasLinking: true,
        linkingCount: 1,
        hasReducedWords: false,
        reducedWordCount: 0,
        hasSoundChanges: false,
        soundChangeCount: 0,
        soundChangeSubtypes: [],
        representativeExamples: []
      },
      {
        rowKey: 'id:2',
        questionId: '2',
        title: 'Prompt 2',
        hasSampleAudio: false,
        hasAnyConnectedSpeech: true,
        hasLinking: true,
        linkingCount: 1,
        hasReducedWords: true,
        reducedWordCount: 1,
        hasSoundChanges: true,
        soundChangeCount: 1,
        soundChangeSubtypes: ['coalescent_dj'],
        representativeExamples: []
      },
      {
        rowKey: 'id:3',
        questionId: '3',
        title: 'Prompt 3',
        hasSampleAudio: false,
        hasAnyConnectedSpeech: false,
        hasLinking: false,
        linkingCount: 0,
        hasReducedWords: false,
        reducedWordCount: 0,
        hasSoundChanges: false,
        soundChangeCount: 0,
        soundChangeSubtypes: [],
        representativeExamples: []
      }
    ]
  }, null, 2));

  const recent = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
  const older = new Date(Date.now() - (20 * 24 * 60 * 60 * 1000));
  const db = {
    collection(name) {
      if (name !== 'readAloudConnectedSpeechAttempts') {
        return {
          async get() {
            return { docs: [] };
          }
        };
      }
      return createMockAttemptCollection([
        {
          attemptId: 'a1',
          questionId: '1',
          createdAt: recent,
          clientContext: {
            guideLevel: 'v1_linking',
            promptFamilyFilter: 'linking',
            promptIndexVersion: '1'
          },
          requestedAlignmentMode: 'heuristic',
          scoringMode: 'heuristic',
          workerStatus: 'complete',
          audioQualityPassed: true,
          promptIndexVersion: '1',
          promptFeatureSnapshot: {
            questionId: '1',
            title: 'Prompt 1',
            hasSoundChanges: false
          }
        },
        {
          attemptId: 'a2',
          questionId: '2',
          createdAt: recent,
          clientContext: {
            guideLevel: 'v3_sound_changes',
            promptFamilyFilter: 'sound_changes',
            promptIndexVersion: '2'
          },
          requestedAlignmentMode: 'shadow_mfa',
          scoringMode: 'heuristic',
          alignmentFallbackReason: 'mfa_unavailable',
          connectedSpeechShadow: {
            status: 'shadow_placeholder',
            version: 'cs-v1',
            summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
            events: [],
            shadowKind: 'placeholder',
            engine: 'none',
            mode: 'shadow_mfa',
            primarySource: 'heuristic'
          },
          workerStatus: 'fallback',
          audioQualityReason: 'clipped',
          audioQualityPassed: false,
          promptIndexVersion: '1',
          promptFeatureSnapshot: {
            questionId: '2',
            title: 'Prompt 2',
            hasSoundChanges: false
          }
        },
        {
          attemptId: 'a3',
          questionId: '3',
          createdAt: recent,
          clientContext: {
            guideLevel: 'v3_sound_changes',
            promptFamilyFilter: 'sound_changes'
          },
          scoringMode: 'heuristic',
          workerStatus: 'complete',
          audioQualityPassed: null,
          promptIndexVersion: '',
          promptFeatureSnapshot: {
            questionId: '3',
            title: 'Prompt 3',
            hasSoundChanges: true
          }
        },
        {
          attemptId: 'a4',
          questionId: '4',
          createdAt: older,
          clientContext: {
            guideLevel: 'v2_reduced_words',
            promptFamilyFilter: 'reduced_words'
          },
          requestedAlignmentMode: 'mfa_primary',
          scoringMode: 'heuristic',
          alignmentFallbackReason: 'mfa_unavailable',
          workerStatus: 'complete',
          audioQualityPassed: true,
          promptIndexVersion: '1',
          promptFeatureSnapshot: {
            questionId: '4',
            title: 'Prompt 4',
            hasSoundChanges: true
          }
        }
      ]);
    }
  };

  const router = createCrmRouter({
    db,
    admin: {},
    authMiddleware: (req, _res, next) => {
      req.user = { uid: 'admin-1', email: 'admin@example.com' };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
    sendSuccess: (res, data) => res.status(200).json({ success: true, ...data }),
    sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u2' }),
      forceLinkProfile: async () => ({ success: true })
    },
    readAloudIndexPath: indexPath
  });

  const promptHandlers = getRouteHandlers(router, '/read-aloud/prompt-summary', 'get');
  const usageHandlers = getRouteHandlers(router, '/read-aloud/usage-summary', 'get');
  const res1 = buildRes();
  await invokeHandlers(promptHandlers, { headers: {}, query: {}, user: null }, res1);
  assert.strictEqual(res1._status, 200, 'prompt summary should return 200');
  assert.strictEqual(res1._json.promptSummary.promptCount, 3, 'prompt summary should count all prompts');
  assert.strictEqual(res1._json.promptSummary.audioAvailableCount, 1, 'prompt summary should count sample audio');
  assert.strictEqual(res1._json.promptSummary.soundChangeCount, 1, 'prompt summary should count sound-change prompts');
  assert.ok(Array.isArray(res1._json.promptSummary.samplePrompts), 'prompt summary should expose sample prompts');

  const res2 = buildRes();
  await invokeHandlers(usageHandlers, { headers: {}, query: { days: '7' }, user: null }, res2);
  assert.strictEqual(res2._status, 200, 'usage summary should return 200');
  assert.strictEqual(res2._json.usageSummary.periodDays, 7, 'usage summary should reflect the requested period');
  assert.strictEqual(res2._json.usageSummary.attemptCount, 3, 'usage summary should exclude old attempts');
  assert.strictEqual(res2._json.usageSummary.guideLevelCounts.v3_sound_changes, 2, 'usage summary should count guide levels');
  assert.strictEqual(res2._json.usageSummary.familyFilterCounts.sound_changes, 2, 'usage summary should count family filters');
  assert.strictEqual(res2._json.usageSummary.requestedAlignmentModeCounts.shadow_mfa, 1, 'usage summary should count requested alignment modes');
  assert.strictEqual(res2._json.usageSummary.requestedAlignmentModeCounts.legacy_unknown, 1, 'usage summary should preserve legacy requests');
  assert.strictEqual(res2._json.usageSummary.actualScoringModeCounts.heuristic, 3, 'usage summary should count actual scoring modes');
  assert.strictEqual(res2._json.usageSummary.scoringModeCounts.heuristic, 3, 'legacy scoring alias should remain available');
  assert.strictEqual(res2._json.usageSummary.alignmentFallbackReasonCounts.mfa_unavailable, 1, 'usage summary should count fallback reasons');
  assert.strictEqual(res2._json.usageSummary.realShadowAttemptCount, 0, 'usage summary should count only real shadow attempts');
  assert.strictEqual(res2._json.usageSummary.shadowPlaceholderCount, 1, 'usage summary should count shadow placeholders');
  assert.strictEqual(res2._json.usageSummary.shadowAttemptCount, 1, 'usage summary should preserve the legacy shadow total');
  assert.strictEqual(res2._json.usageSummary.workerStatusCounts.fallback, 1, 'usage summary should count worker statuses');
  assert.strictEqual(res2._json.usageSummary.audioQualityOutcomeCounts.failed, 1, 'usage summary should count audio quality failures');
  assert.strictEqual(res2._json.usageSummary.audioQualityOutcomeCounts.passed, 1, 'usage summary should count passed audio quality attempts');
  assert.strictEqual(res2._json.usageSummary.audioQualityOutcomeCounts.missing, 1, 'usage summary should count missing audio quality attempts');
  assert.strictEqual(res2._json.usageSummary.audioQualityFailureReasonCounts.clipped, 1, 'usage summary should count audio quality reasons');
  assert.strictEqual(res2._json.usageSummary.audioQualityReasonCounts.clipped, 1, 'legacy audio quality reason alias should remain available');
  assert.strictEqual(res2._json.usageSummary.promptIndexVersionComparableCount, 2, 'usage summary should count comparable prompt index versions');
  assert.strictEqual(res2._json.usageSummary.promptIndexVersionMismatchCount, 1, 'usage summary should count prompt index mismatches');
  assert.strictEqual(res2._json.usageSummary.promptIndexVersionUncomparableCount, 1, 'usage summary should count uncomparable prompt index versions');
  assert.strictEqual(res2._json.usageSummary.v3NoSoundChangeCount, 1, 'usage summary should count V3 attempts without sound changes');
  assert.ok(Array.isArray(res2._json.usageSummary.topPrompts), 'usage summary should expose top prompts');

  const missingRouter = createCrmRouter({
    db,
    admin: {},
    authMiddleware: (req, _res, next) => {
      req.user = { uid: 'admin-1', email: 'admin@example.com' };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
    sendSuccess: (res, data) => res.status(200).json({ success: true, ...data }),
    sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u2' }),
      forceLinkProfile: async () => ({ success: true })
    },
    readAloudIndexPath: path.join(tempDir, 'missing-index.json')
  });
  const missingHandlers = getRouteHandlers(missingRouter, '/read-aloud/prompt-summary', 'get');
  const res3 = buildRes();
  await invokeHandlers(missingHandlers, { headers: {}, query: {}, user: null }, res3);
  assert.strictEqual(res3._status, 503, 'missing prompt index should return 503');
  assert.strictEqual(res3._json.error, 'INDEX_UNAVAILABLE', 'missing prompt index should expose the correct error code');

  console.log('crm read aloud reporting routes passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
