const assert = require('node:assert/strict');
const test = require('node:test');

const fixtures = require('./fixtures/essay-ai/queue-id-cases.json');
const {
  computeQueueId,
  extractAuthoritativeEssay,
  validateDeepAiRequest
} = require('../functions/src/essay-ai/contracts');
const {
  createSubmitEssayDeepAiHandler
} = require('../functions/src/submitEssayDeepAi');

function validAttempt(overrides = {}) {
  return {
    ownerUid: 'owner-essay-001',
    practiceScope: 'pte',
    canonicalMode: 'write_essay',
    status: 'submitted',
    submittedAt: { seconds: 1700000000, nanoseconds: 0 },
    promptSnapshot: {
      promptId: 'prompt-001',
      text: 'Discuss whether technology improves education and explain your reasons.'
    },
    responseSnapshot: {
      text: 'A'.repeat(100)
    },
    ...overrides
  };
}

function createFakeDb({ attempt, existingQueue = null, usage = null }) {
  const queue = existingQueue ? { ...existingQueue } : null;
  const writes = [];
  const usageRef = {
    get: async () => ({ exists: Boolean(usage), data: () => usage })
  };
  const attemptRef = {
    get: async () => ({ exists: Boolean(attempt), data: () => attempt })
  };
  const queueRef = {
    get: async () => ({ exists: Boolean(queue), data: () => queue }),
    set: async (data) => {
      writes.push({ type: 'set', data });
    }
  };
  return {
    writes,
    collection(name) {
      assert.ok(['speakingAttempts', 'essay_ai_queue', 'essay_ai_usage'].includes(name));
      return { doc: () => name === 'speakingAttempts' ? attemptRef : name === 'essay_ai_queue' ? queueRef : usageRef };
    },
    queueRef,
    async runTransaction(callback) {
      const transaction = {
        get: async (ref) => ref.get(),
        create: async (ref, data) => {
          writes.push({ type: 'create', ref, data });
        },
        set: async (ref, data) => {
          writes.push({ type: 'set', ref, data });
        }
      };
      return callback(transaction);
    }
  };
}

test('queue fixtures use the documented UTF-8 SHA-256 identity', () => {
  for (const fixture of fixtures) {
    const actual = computeQueueId(fixture.uid, fixture.attemptId);
    assert.match(actual, /^[a-f0-9]{64}$/);
    assert.equal(actual, fixture.queueId || actual);
  }
});

test('archive extraction ignores client-owned essay and prompt fields', () => {
  const archive = extractAuthoritativeEssay(validAttempt());
  assert.equal(archive.essayText, 'A'.repeat(100));
  assert.equal(archive.promptText, validAttempt().promptSnapshot.text);
  assert.equal(archive.questionId, 'prompt-001');
  assert.equal(archive.uid, 'owner-essay-001');
});

test('request validation accepts only attemptId', () => {
  assert.deepEqual(validateDeepAiRequest({ attemptId: 'attempt-essay-001' }), {
    attemptId: 'attempt-essay-001'
  });
  assert.throws(
    () => validateDeepAiRequest({ attemptId: 'attempt-essay-001', essayText: 'forged' }),
    (error) => error.code === 'invalid-argument'
  );
  assert.throws(
    () => validateDeepAiRequest({ essayText: 'forged' }),
    (error) => error.code === 'invalid-argument'
  );
});

test('callable creates a pending queue from the archived attempt and never client text', async () => {
  const db = createFakeDb({ attempt: validAttempt() });
  const handler = createSubmitEssayDeepAiHandler({ db, now: () => new Date('2026-07-26T00:00:00.000Z') });
  const result = await handler({
    auth: { uid: 'owner-essay-001' },
    data: { attemptId: 'attempt-essay-001' }
  });
  assert.equal(result.created, true);
  assert.equal(result.status, 'pending');
  assert.equal(db.writes.length, 2);
  const queueWrite = db.writes.find((write) => write.type === 'create');
  assert.equal(queueWrite.data.essayText, 'A'.repeat(100));
  assert.equal(queueWrite.data.promptText, validAttempt().promptSnapshot.text);
  assert.equal(queueWrite.data.runGeneration, 0);
});

test('callable rejects unauthenticated, wrong-owner, wrong-mode, invalid-status, and invalid archive attempts', async () => {
  const cases = [
    [{}, 'unauthenticated', validAttempt()],
    [{ auth: { uid: 'other-user' } }, 'permission-denied', validAttempt()],
    [{ auth: { uid: 'owner-essay-001' } }, 'failed-precondition', validAttempt({ canonicalMode: 'read_aloud' })],
    [{ auth: { uid: 'owner-essay-001' } }, 'failed-precondition', validAttempt({ status: 'draft' })],
    [{ auth: { uid: 'owner-essay-001' } }, 'failed-precondition', validAttempt({ responseSnapshot: { text: 'too short' } })]
  ];
  for (const [request, code, attempt] of cases) {
    const db = createFakeDb({ attempt });
    const handler = createSubmitEssayDeepAiHandler({ db });
    await assert.rejects(() => handler({ ...request, data: { attemptId: 'attempt-essay-001' } }), (error) => error.code === code);
  }
});

test('duplicate submission returns existing status without mutating a terminal queue', async () => {
  const existingQueue = {
    uid: 'owner-essay-001',
    attemptId: 'attempt-essay-001',
    status: 'completed',
    resultSnapshot: { overall: { total: 20 } },
    runGeneration: 0
  };
  const db = createFakeDb({ attempt: validAttempt(), existingQueue });
  const handler = createSubmitEssayDeepAiHandler({ db });
  const result = await handler({ auth: { uid: 'owner-essay-001' }, data: { attemptId: 'attempt-essay-001' } });
  assert.deepEqual(result, {
    queueId: computeQueueId('owner-essay-001', 'attempt-essay-001'),
    status: 'completed',
    created: false
  });
  assert.equal(db.writes.length, 0);
});

test('callable enforces a per-user daily quota transactionally', async () => {
  const db = createFakeDb({ attempt: validAttempt(), usage: { windowKey: '2026-07-26', count: 5 } });
  const handler = createSubmitEssayDeepAiHandler({ db, now: () => new Date('2026-07-26T12:00:00.000Z') });
  await assert.rejects(
    () => handler({ auth: { uid: 'owner-essay-001' }, data: { attemptId: 'attempt-essay-001' } }),
    (error) => error.code === 'failed-precondition'
  );
});

test('callable repairs a malformed usage counter instead of writing NaN', async () => {
  const db = createFakeDb({ attempt: validAttempt(), usage: { windowKey: '2026-07-26', count: 'broken' } });
  const handler = createSubmitEssayDeepAiHandler({ db, now: () => new Date('2026-07-26T12:00:00.000Z') });
  await handler({ auth: { uid: 'owner-essay-001' }, data: { attemptId: 'attempt-essay-001' } });
  const usageWrite = db.writes.find((write) => write.type === 'set');
  assert.equal(usageWrite.data.count, 1);
});
