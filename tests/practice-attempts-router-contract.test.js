const assert = require('assert');
const fs = require('fs');
const path = require('path');
const createPracticeAttemptsRouter = require('../functions/src/routes/practice-attempts');
const {
  buildRes,
  createFakeDb,
  getRouteHandlers,
  invokeHandlers
} = require('./crm/route-test-helpers');
/* eslint-disable no-console */

console.log('Starting practice attempts router contract test...');

const filePath = path.join(process.cwd(), 'functions', 'src', 'routes', 'practice-attempts.js');
assert.ok(fs.existsSync(filePath), 'functions/src/routes/practice-attempts.js should exist');

const src = fs.readFileSync(filePath, 'utf8');

assert.ok(
  src.includes("router.post('/prepare'"),
  'prepare endpoint should exist'
);
assert.ok(
  src.includes("router.post('/save'"),
  'save endpoint should exist for non-media and completed-media PTE archives'
);
assert.ok(
  src.includes("const ATTEMPTS_COLLECTION = 'speakingAttempts'"),
  'route should generalize attempts behind ATTEMPTS_COLLECTION while keeping legacy collection compatibility'
);
assert.ok(
  src.includes('schemaVersion: 2'),
  'new PTE archive attempts should write schemaVersion: 2'
);
assert.ok(
  src.includes("practiceScope: 'pte'"),
  'new attempt documents should persist practiceScope: pte'
);
assert.ok(
  src.includes('PTE_MODE_META'),
  'route should use a strict server-side PTE mode allowlist'
);
assert.ok(
  src.includes('INVALID_PRACTICE_SCOPE'),
  'save endpoint should reject non-PTE practice scopes'
);
assert.ok(
  src.includes('INVALID_PRACTICE_MODE'),
  'save endpoint should reject modes outside the PTE allowlist'
);
assert.ok(
  src.includes('const requestedAttemptId = cleanString(req.body?.attemptId, 128)'),
  'prepare endpoint should accept optional attemptId'
);
assert.ok(
  src.includes('sanitizeArchiveSnapshot'),
  'save endpoint should sanitize structured archive snapshots before persisting'
);
assert.ok(
  src.includes('sanitizeMediaSlots'),
  'prepare/save flow should support slot-based media manifests'
);
assert.ok(
  !src.includes('skipMediaValidation'),
  'client requests must not be able to bypass server-side media validation'
);
assert.ok(
  src.includes("req.query?.practiceScope"),
  'mine listing should support practiceScope filtering for learner PTE history'
);
assert.ok(
  src.includes('clientReportedDurationMs'),
  'WebM media should be allowed with client-reported duration metadata'
);
assert.ok(
  src.includes('MEDIA_DURATION_REQUIRED'),
  'WebM media should be rejected when client-reported duration metadata is missing'
);
assert.ok(
  src.includes('AUDIO_DURATION_EXCEEDED'),
  'complete endpoint should enforce duration limits'
);
assert.ok(
  src.includes('constraintSnapshot'),
  'attempts should persist mode constraint snapshots'
);
assert.ok(
  src.includes('SPEAKING_ATTEMPT_COUNTERS'),
  'bookmark logic should use speakingAttemptCounters collection'
);
assert.ok(
  src.includes('reviewer.allowedStudentIds'),
  'reviewer access should be scoped to authorized CRM student ids'
);
assert.ok(
  src.includes('attempt.crmStudentId'),
  'attempt authorization should compare reviewer access against attempt crmStudentId'
);
assert.ok(
  src.includes("router.get('/:attemptId/feedback'"),
  'feedback list endpoint should exist'
);
assert.ok(
  src.includes("router.patch('/:attemptId/feedback/:feedbackId'"),
  'feedback edit endpoint should exist'
);
assert.ok(
  src.includes("router.delete('/:attemptId/feedback/:feedbackId'"),
  'feedback delete endpoint should exist'
);

function createRouteHarness() {
  const baseDb = createFakeDb({
    'speakingAttempts/owned-read-aloud': {
      ownerUid: 'owner-1',
      practiceScope: 'pte',
      practiceMode: 'read-aloud',
      answerSnapshot: null,
      resultSnapshot: null,
      responseSnapshot: { referenceText: 'Rates of change matter.' },
      scoringSnapshot: { source: 'none', success: false, status: 'unassessed' }
    },
    'speakingAttempts/other-owner': {
      ownerUid: 'owner-2',
      practiceScope: 'pte',
      practiceMode: 'read-aloud',
      answerSnapshot: null
    },
    'speakingAttempts/non-pte': {
      ownerUid: 'owner-1',
      practiceScope: 'english',
      practiceMode: 'read-aloud',
      answerSnapshot: null
    }
  });
  const db = {
    ...baseDb,
    collection(name) {
      if (name === 'speakingAttemptEvents') {
        return { add: async () => ({ id: 'event-1' }) };
      }
      return baseDb.collection(name);
    }
  };
  const router = createPracticeAttemptsRouter({
    db,
    getStorageBucket: async () => { throw new Error('storage should not be used by snapshot patch tests'); },
    serverTimestamp: () => 'server-timestamp',
    sendSuccess(res, data, message) {
      return res.status(200).json({ success: true, data, message });
    },
    sendError(res, status, code, message, details) {
      return res.status(status).json({ success: false, error: code, message, details });
    }
  });
  return { baseDb, handlers: getRouteHandlers(router, '/:attemptId/result', 'patch') };
}

async function callPatch(handlers, { uid, attemptId, body }) {
  const req = { user: uid ? { uid } : null, params: { attemptId }, body };
  const res = buildRes();
  await invokeHandlers(handlers, req, res);
  return res;
}

async function verifyAssessedSnapshotRouteContract() {
  const { baseDb, handlers } = createRouteHarness();
  const answerSnapshot = {
    referenceText: 'Rates of change matter.',
    words: [{
      word: 'rates',
      accuracyScore: 48,
      startMs: 320,
      endMs: 740,
      syllables: [{ text: 'rates', score: 48, startMs: 320, endMs: 740 }]
    }]
  };

  const allowed = await callPatch(handlers, {
    uid: 'owner-1',
    attemptId: 'owned-read-aloud',
    body: {
      answerSnapshot,
      resultSnapshot: { accuracyScore: 84, fluencyScore: 78, completenessScore: 96, pronScore: 82 },
      scoringSnapshot: { source: 'azure', success: true },
      ownerUid: 'attacker-controlled-owner',
      practiceScope: 'english',
      arbitraryField: { unsafe: true }
    }
  });
  assert.strictEqual(allowed._status, 200, 'owner should be allowed to patch assessed snapshots');
  const stored = baseDb.docs.get('speakingAttempts/owned-read-aloud');
  assert.deepStrictEqual(stored.answerSnapshot, answerSnapshot, 'route should persist and reload complete per-word assessment data');
  assert.strictEqual(stored.ownerUid, 'owner-1', 'unsupported ownerUid must be ignored');
  assert.strictEqual(stored.practiceScope, 'pte', 'unsupported practiceScope must be ignored');
  assert.ok(!Object.prototype.hasOwnProperty.call(stored, 'arbitraryField'), 'arbitrary fields must not be persisted');

  const unsupportedOnly = await callPatch(handlers, {
    uid: 'owner-1',
    attemptId: 'owned-read-aloud',
    body: { ownerUid: 'attacker-controlled-owner', arbitraryField: true }
  });
  assert.strictEqual(unsupportedOnly._status, 400, 'a patch with no supported fields should be rejected');
  assert.strictEqual(unsupportedOnly._json.error, 'VALIDATION_ERROR');

  const forbidden = await callPatch(handlers, {
    uid: 'owner-1',
    attemptId: 'other-owner',
    body: { answerSnapshot }
  });
  assert.strictEqual(forbidden._status, 403, 'a signed-in non-owner must not patch another learner attempt');
  assert.strictEqual(baseDb.docs.get('speakingAttempts/other-owner').answerSnapshot, null);

  const unauthenticated = await callPatch(handlers, {
    uid: null,
    attemptId: 'owned-read-aloud',
    body: { answerSnapshot }
  });
  assert.strictEqual(unauthenticated._status, 401, 'missing identity should be rejected');

  const wrongScope = await callPatch(handlers, {
    uid: 'owner-1',
    attemptId: 'non-pte',
    body: { answerSnapshot }
  });
  assert.strictEqual(wrongScope._status, 400, 'non-PTE attempts must remain outside this patch contract');
  assert.strictEqual(wrongScope._json.error, 'INVALID_PRACTICE_SCOPE');

  const backwardCompatible = await callPatch(handlers, {
    uid: 'owner-1',
    attemptId: 'owned-read-aloud',
    body: { result: { accuracyScore: 91 } }
  });
  assert.strictEqual(backwardCompatible._status, 200, 'legacy result alias should remain supported');
  assert.deepStrictEqual(baseDb.docs.get('speakingAttempts/owned-read-aloud').resultSnapshot, { accuracyScore: 91 });
}

verifyAssessedSnapshotRouteContract()
  .then(() => console.log('Practice attempts router contract test passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
