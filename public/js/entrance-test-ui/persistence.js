export const DB_NAME = 'bel-entrance-test-ui-demo';
export const DB_VERSION = 1;
export const ACTIVE_ATTEMPT_KEY = 'activeAttemptId';

const realClock = {
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: (...args) => globalThis.clearTimeout(...args),
  now: () => new Date().toISOString()
};

export class RevisionConflictError extends Error {
  constructor(expectedRevision, actualRevision) {
    super(`Draft revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = 'RevisionConflictError';
    this.code = 'REVISION_CONFLICT';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function assertExpectedRevision(expectedRevision, actualRevision) {
  if (Number(expectedRevision) !== Number(actualRevision)) {
    throw new RevisionConflictError(expectedRevision, actualRevision);
  }
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft));
}

function recordingKey(attemptId, questionId, takeId) {
  return [String(attemptId), String(questionId), String(takeId)];
}

function recordIdFromRef(ref) {
  return ref && ref.recordId ? String(ref.recordId) : '';
}

export async function openDemoStore({ indexedDB = globalThis.indexedDB, clock = realClock } = {}) {
  if (!indexedDB) throw new Error('IndexedDB is unavailable in this browser');
  const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
  openRequest.onupgradeneeded = () => {
    const database = openRequest.result;
    if (!database.objectStoreNames.contains('attempts')) database.createObjectStore('attempts', { keyPath: 'attemptId' });
    if (!database.objectStoreNames.contains('recordings')) database.createObjectStore('recordings', { keyPath: 'key' });
    if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'name' });
  };
  const database = await requestPromise(openRequest);

  async function loadAttempt(attemptId) {
    const transaction = database.transaction('attempts', 'readonly');
    return requestPromise(transaction.objectStore('attempts').get(attemptId));
  }

  async function saveDraft(draft) {
    const value = cloneDraft(draft);
    const transaction = database.transaction(['attempts', 'meta'], 'readwrite');
    const attempts = transaction.objectStore('attempts');
    const existing = await requestPromise(attempts.get(value.attemptId));
    if (existing && Number(existing.revision) > Number(value.revision)) {
      transaction.abort();
      throw new RevisionConflictError(value.revision, existing.revision);
    }
    attempts.put(value);
    transaction.objectStore('meta').put({ name: ACTIVE_ATTEMPT_KEY, attemptId: value.attemptId });
    await transactionPromise(transaction);
    return { committedRevision: value.revision, committedAt: clock.now ? clock.now() : new Date().toISOString() };
  }

  async function commitRecording({ draft, questionId, takeId, blob, metadata = {} }) {
    const value = cloneDraft(draft);
    const transaction = database.transaction(['attempts', 'recordings', 'meta'], 'readwrite');
    const attempts = transaction.objectStore('attempts');
    const recordings = transaction.objectStore('recordings');
    const existing = await requestPromise(attempts.get(value.attemptId));
    if (existing && Number(existing.revision) > Number(value.revision)) {
      transaction.abort();
      throw new RevisionConflictError(value.revision, existing.revision);
    }
    const oldRef = existing && existing.recordingRefs && existing.recordingRefs[questionId];
    const recordId = String(metadata.recordId || `${value.attemptId}:${questionId}:${takeId}`);
    const record = {
      key: recordingKey(value.attemptId, questionId, takeId),
      attemptId: value.attemptId,
      questionId,
      takeId,
      recordId,
      blob,
      mimeType: metadata.mimeType || blob.type || 'application/octet-stream',
      durationMs: Number(metadata.durationMs) || 0,
      fixture: Boolean(metadata.fixture)
    };
    recordings.put(record);
    attempts.put(value);
    transaction.objectStore('meta').put({ name: ACTIVE_ATTEMPT_KEY, attemptId: value.attemptId });
    if (oldRef && oldRef.takeId && oldRef.takeId !== takeId) {
      recordings.delete(recordingKey(value.attemptId, questionId, oldRef.takeId));
    }
    await transactionPromise(transaction);
    return { recordId, takeId, mimeType: record.mimeType, durationMs: record.durationMs, fixture: record.fixture };
  }

  async function loadRecording({ attemptId, questionId, takeId }) {
    const transaction = database.transaction('recordings', 'readonly');
    const record = await requestPromise(transaction.objectStore('recordings').get(recordingKey(attemptId, questionId, takeId)));
    return record ? record.blob : null;
  }

  async function commitSubmission({ attemptId, expectedRevision, receiptId }) {
    const transaction = database.transaction(['attempts', 'meta'], 'readwrite');
    const attempts = transaction.objectStore('attempts');
    const existing = await requestPromise(attempts.get(attemptId));
    if (!existing) {
      transaction.abort();
      throw new Error('Attempt not found');
    }
    if (existing.submission) {
      await transactionPromise(transaction);
      return existing.submission;
    }
    assertExpectedRevision(expectedRevision, existing.revision);
    const submission = {
      receiptId: String(receiptId),
      draftRevision: existing.revision,
      committedAt: clock.now ? clock.now() : new Date().toISOString(),
      mode: 'demo-local'
    };
    attempts.put({ ...existing, submission, view: 'done' });
    transaction.objectStore('meta').put({ name: ACTIVE_ATTEMPT_KEY, attemptId });
    await transactionPromise(transaction);
    return submission;
  }

  async function resetAttempt(attemptId) {
    const transaction = database.transaction(['attempts', 'recordings', 'meta'], 'readwrite');
    transaction.objectStore('attempts').delete(attemptId);
    const recordings = transaction.objectStore('recordings');
    const cursorRequest = recordings.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      if (cursor.value && cursor.value.attemptId === attemptId) cursor.delete();
      cursor.continue();
    };
    const meta = transaction.objectStore('meta');
    const active = await requestPromise(meta.get(ACTIVE_ATTEMPT_KEY));
    if (active && active.attemptId === attemptId) meta.delete(ACTIVE_ATTEMPT_KEY);
    await transactionPromise(transaction);
  }

  return {
    loadAttempt,
    saveDraft,
    commitRecording,
    loadRecording,
    commitSubmission,
    resetAttempt,
    close: () => database.close()
  };
}

export function createDraftQueue({ saveDraft, clock = realClock, debounceMs = 250 }) {
  if (typeof saveDraft !== 'function') throw new TypeError('saveDraft callback is required');
  let timer = null;
  let pending = null;
  let lastDraft = null;
  let inFlight = null;
  let savedRevision = -1;
  let lastError = null;
  const waiters = [];

  function schedule() {
    if (timer) clock.clearTimeout(timer);
    timer = clock.setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, debounceMs);
  }

  function enqueue(draft) {
    lastDraft = draft;
    pending = draft;
    lastError = null;
    const promise = new Promise((resolve, reject) => waiters.push({ revision: draft.revision, resolve, reject }));
    schedule();
    return promise;
  }

  async function flush() {
    if (inFlight) return inFlight;
    if (!pending) return null;
    const draft = pending;
    pending = null;
    let saveResult;
    try {
      saveResult = saveDraft(draft);
    } catch (error) {
      saveResult = Promise.reject(error);
    }
    inFlight = Promise.resolve(saveResult).then((result) => {
      savedRevision = Math.max(savedRevision, Number(result.committedRevision));
      lastError = null;
      waiters.splice(0).forEach((waiter) => {
        if (waiter.revision <= Number(result.committedRevision)) waiter.resolve(result);
        else waiters.push(waiter);
      });
      return result;
    }).catch((error) => {
      lastError = error;
      const failedRevision = Number(draft.revision);
      const keep = [];
      waiters.splice(0).forEach((waiter) => {
        if (waiter.revision <= failedRevision) waiter.reject(error);
        else keep.push(waiter);
      });
      keep.forEach((waiter) => waiters.push(waiter));
      throw error;
    }).finally(() => {
      inFlight = null;
      if (pending) schedule();
    });
    return inFlight;
  }

  function flushNow() {
    if (timer) { clock.clearTimeout(timer); timer = null; }
    return flush();
  }

  function retry() {
    if (!lastDraft) return Promise.resolve(null);
    return enqueue(lastDraft);
  }

  function getState(currentRevision) {
    const current = Number(currentRevision);
    if (lastError) return { status: 'error', savedRevision, currentRevision: current, error: lastError };
    if (savedRevision === current) return { status: 'saved', savedRevision, currentRevision: current };
    if (pending) return { status: 'dirty', savedRevision, currentRevision: current };
    if (inFlight || pending) return { status: 'saving', savedRevision, currentRevision: current };
    return { status: 'dirty', savedRevision, currentRevision: current };
  }

  return {
    enqueue,
    flush,
    flushNow,
    retry,
    isSaved: (currentRevision) => getState(currentRevision).status === 'saved',
    getState
  };
}

export function createTakeGuard({ idFactory = (n) => `take-${n}` } = {}) {
  let sequence = 0;
  const active = new Map();
  return {
    begin(questionId) {
      const takeId = idFactory(++sequence);
      active.set(questionId, takeId);
      return takeId;
    },
    has(questionId) { return active.has(questionId); },
    isCurrent(questionId, takeId) { return active.get(questionId) === takeId; },
    invalidate(questionId) { active.delete(questionId); }
  };
}

export function createRecordingCommitController({ commitRecording, takeGuard = createTakeGuard() }) {
  return {
    begin(questionId) { return takeGuard.begin(questionId); },
    invalidate(questionId) { takeGuard.invalidate(questionId); },
    async commit({ questionId, takeId, previousRef = null, ...payload }) {
      if (takeGuard.has(questionId) && !takeGuard.isCurrent(questionId, takeId)) {
        return { ok: false, stale: true, preservedRef: previousRef };
      }
      try {
        const ref = await commitRecording({ questionId, takeId, ...payload });
        return { ok: true, stale: false, ref };
      } catch (error) {
        return { ok: false, stale: false, preservedRef: previousRef, error };
      }
    }
  };
}
