import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RevisionConflictError,
  assertExpectedRevision,
  createDraftQueue,
  createRecordingCommitController,
  createTakeGuard
} from '../../public/js/entrance-test-ui/persistence.js';

function manualClock() {
  const timers = [];
  return {
    setTimeout(fn) { timers.push(fn); return fn; },
    clearTimeout(handle) { const index = timers.indexOf(handle); if (index !== -1) timers.splice(index, 1); },
    runAll() { const current = timers.splice(0); current.forEach((fn) => fn()); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('draft queue coalesces multiple edits before the debounce flush', async () => {
  const clock = manualClock();
  const calls = [];
  const queue = createDraftQueue({
    debounceMs: 250,
    clock,
    saveDraft: async (value) => {
      calls.push(value);
      return { committedRevision: value.revision, committedAt: 'now' };
    }
  });
  const first = queue.enqueue({ revision: 1, value: 'old' });
  const latest = queue.enqueue({ revision: 2, value: 'new' });
  clock.runAll();
  await Promise.all([first, latest]);

  assert.deepEqual(calls, [{ revision: 2, value: 'new' }]);
  assert.equal(queue.getState(2).status, 'saved');
});

test('late revision acknowledgements never mark newer dirty work saved', async () => {
  const clock = manualClock();
  const calls = [];
  const pending = [];
  const queue = createDraftQueue({
    debounceMs: 250,
    clock,
    saveDraft: (value) => {
      calls.push(value);
      const wait = deferred();
      pending.push(wait);
      return wait.promise;
    }
  });

  const first = queue.enqueue({ revision: 1, value: 'one' });
  clock.runAll();
  const second = queue.enqueue({ revision: 2, value: 'two' });
  pending[0].resolve({ committedRevision: 1, committedAt: 'first' });
  await first;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(queue.getState(2).status, 'dirty');
  assert.equal(queue.isSaved(2), false);

  clock.runAll();
  assert.equal(calls.length, 2);
  pending[1].resolve({ committedRevision: 2, committedAt: 'second' });
  await second;
  assert.equal(queue.isSaved(2), true);
});

test('failed writes keep the draft dirty and retry the same revision', async () => {
  const clock = manualClock();
  const pending = [];
  const queue = createDraftQueue({
    debounceMs: 250,
    clock,
    saveDraft: () => {
      const wait = deferred();
      pending.push(wait);
      return wait.promise;
    }
  });
  const first = queue.enqueue({ revision: 4, value: 'keep visible' });
  clock.runAll();
  pending[0].reject(new Error('quota'));
  await assert.rejects(first, /quota/);
  assert.equal(queue.getState(4).status, 'error');
  const retry = queue.retry();
  clock.runAll();
  pending[1].resolve({ committedRevision: 4, committedAt: 'retry' });
  await retry;
  assert.equal(queue.isSaved(4), true);
});

test('take guard ignores delayed callbacks after navigation or replacement', () => {
  const guard = createTakeGuard({ idFactory: (n) => `take-${n}` });
  const first = guard.begin('speaking_q1');
  const replacement = guard.begin('speaking_q1');
  assert.equal(guard.isCurrent('speaking_q1', first), false);
  assert.equal(guard.isCurrent('speaking_q1', replacement), true);
  guard.invalidate('speaking_q1');
  assert.equal(guard.isCurrent('speaking_q1', replacement), false);
});

test('failed recording replacement returns the previous committed reference', async () => {
  const oldRef = { recordId: 'record-1', takeId: 'take-old', mimeType: 'audio/wav', durationMs: 900 };
  const controller = createRecordingCommitController({
    commitRecording: async () => { throw new Error('storage failed'); }
  });
  const result = await controller.commit({
    questionId: 'speaking_q1',
    takeId: 'take-new',
    previousRef: oldRef,
    blob: { size: 10 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.stale, false);
  assert.deepEqual(result.preservedRef, oldRef);
  assert.match(result.error.message, /storage failed/);
});

test('optimistic revision conflicts are explicit and machine-detectable', () => {
  assert.doesNotThrow(() => assertExpectedRevision(3, 3));
  assert.throws(() => assertExpectedRevision(3, 4), (error) => {
    assert.equal(error instanceof RevisionConflictError, true);
    assert.equal(error.code, 'REVISION_CONFLICT');
    return true;
  });
});
