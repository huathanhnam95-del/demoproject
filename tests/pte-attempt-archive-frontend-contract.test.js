const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* eslint-disable no-console */

console.log('Starting PTE attempt archive frontend contract test...');

const helperPath = path.join(process.cwd(), 'public', 'js', 'pte-attempt-archive.js');
const indexPath = path.join(process.cwd(), 'public', 'index.html');
const asyncPatchModePaths = [
  path.join(process.cwd(), 'public', 'write-essay-mode.js'),
  path.join(process.cwd(), 'public', 'swt-mode.js'),
  path.join(process.cwd(), 'public', 'sst-mode.js'),
  path.join(process.cwd(), 'public', 'rts-mode.js')
];
assert.ok(fs.existsSync(helperPath), 'public/js/pte-attempt-archive.js should exist');

const helper = fs.readFileSync(helperPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const asyncPatchModes = asyncPatchModePaths.map((filePath) => ({
  filePath,
  src: fs.readFileSync(filePath, 'utf8')
}));

assert.ok(
  helper.includes('window.PTEAttemptArchive'),
  'archive helper should expose window.PTEAttemptArchive'
);
assert.ok(
  helper.includes("PracticeScopeManager.getScope() !== 'pte'"),
  'archive helper should no-op outside PTE scope'
);
assert.ok(
  helper.includes('/api/practice-attempts/save'),
  'archive helper should call the save endpoint'
);
assert.ok(
  helper.includes('/api/practice-attempts/prepare'),
  'archive helper should prepare media uploads'
);
assert.ok(
  helper.includes('firebase.storage()'),
  'archive helper should upload media through Firebase Storage compat'
);
assert.ok(
  helper.includes('normalizePositiveDurationMs'),
  'archive helper should normalize client-reported media durations through a positive-duration helper'
);
assert.ok(
  helper.includes('durationMs > 0'),
  'archive helper should treat null/zero WebM durations as missing so metadata hydration runs'
);
assert.ok(
  helper.includes('readBlobDurationMs(item.blob)'),
  'archive helper should read WebM Blob metadata before preparing/uploading media'
);
assert.ok(
  helper.includes('patchAttempt'),
  'archive helper should expose patchAttempt for delayed AI scoring updates'
);
assert.ok(
  index.includes('firebase-storage-compat.js'),
  'index.html should load Firebase Storage compat for media uploads'
);
assert.ok(
  index.includes('js/pte-attempt-archive.js'),
  'index.html should load the PTE archive helper before mode scripts'
);
asyncPatchModes.forEach(({ filePath, src }) => {
  assert.ok(
    /archiveSavePromise|ArchiveSavePromise/.test(src) && src.includes('ensureArchiveAttemptId'),
    `${path.basename(filePath)} should wait for the initial archive save before patching delayed AI scoring`
  );
});

async function verifyAssessedSnapshotPatchContract() {
  const fetchCalls = [];
  const sandboxWindow = {
    location: { pathname: '/practice/speaking/read-aloud/1025' },
    PracticeScopeManager: {
      getScope: () => 'pte',
      subscribe: () => () => {}
    },
    __FIREBASE_INTERNAL__: {
      auth: {
        currentUser: {
          getIdToken: async () => 'archive-contract-token'
        }
      }
    },
    addEventListener: () => {},
    dispatchEvent: () => {}
  };
  const sandbox = {
    window: sandboxWindow,
    PracticeScopeManager: sandboxWindow.PracticeScopeManager,
    document: {
      readyState: 'loading',
      addEventListener: () => {}
    },
    console,
    URLSearchParams,
    Blob,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { attemptId: 'attempt-read-aloud-1', patched: true } })
      };
    }
  };
  sandboxWindow.window = sandboxWindow;
  vm.runInNewContext(helper, sandbox, { filename: helperPath });

  const answerSnapshot = {
    referenceText: 'Rates of change matter.',
    words: [{ word: 'rates', accuracyScore: 48, startMs: 320, endMs: 740, syllables: [{ text: 'rates', score: 48 }] }]
  };
  await sandboxWindow.PTEAttemptArchive.patchAttempt('attempt-read-aloud-1', {
    answerSnapshot,
    resultSnapshot: { accuracyScore: 84 },
    scoringSnapshot: { source: 'azure', success: true },
    ownerUid: 'attacker-controlled-owner',
    practiceScope: 'english',
    arbitraryField: { unsafe: true }
  });

  assert.strictEqual(fetchCalls.length, 1, 'assessed snapshot patch should make one API request');
  assert.strictEqual(fetchCalls[0].url, '/api/practice-attempts/attempt-read-aloud-1/result');
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.ok(body.answerSnapshot, 'patchAttempt should include the assessed answer snapshot');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(body.answerSnapshot)),
    answerSnapshot,
    'patchAttempt should forward the complete assessed answer snapshot including per-word data'
  );
  assert.deepStrictEqual(
    Object.keys(body).sort(),
    ['answerSnapshot', 'resultSnapshot', 'scoringSnapshot'],
    'patchAttempt should forward only explicitly supported snapshot fields'
  );
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'ownerUid'), 'ownerUid must never be client-patchable');
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'practiceScope'), 'practiceScope must never be client-patchable');
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'arbitraryField'), 'arbitrary fields must never be forwarded');
}

async function verifyPublicationOwnershipContract() {
  const pending = new Map(), events = [], requests = [];
  const sandboxWindow = {
    location: { pathname: '/' },
    PracticeScopeManager: { getScope: () => 'pte', subscribe: () => () => {} },
    auth: { currentUser: { getIdToken: async () => 'local-contract-token' } },
    addEventListener: () => {}, dispatchEvent: event => events.push(event),
    cacheInvalidations: 0
  };
  const sandbox = {
    window: sandboxWindow, PracticeScopeManager: sandboxWindow.PracticeScopeManager,
    document: { readyState: 'loading', addEventListener: () => {} },
    console, URLSearchParams, Blob, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return new Promise(resolve => pending.set(body.attemptId, ok => resolve({
        ok, status: ok ? 200 : 503,
        json: async () => ok ? { data: { attemptId: body.attemptId } } : { success: false, message: 'Save failed' }
      })));
    }
  };
  // Observe the private cache boundary without replacing it or the save client.
  const observedHelper = helper.replace('function invalidateHistoryCache() {',
    'function invalidateHistoryCache() { window.cacheInvalidations++;');
  assert.notStrictEqual(observedHelper, helper, 'cache observation must attach to the real boundary');
  vm.runInNewContext(observedHelper, sandbox, { filename: helperPath });
  const archive = sandboxWindow.PTEAttemptArchive;
  async function waitForRequest(id) {
    for (let i = 0; !pending.has(id) && i < 20; i++) await Promise.resolve();
    assert.ok(pending.has(id), 'save must reach the deferred HTTP boundary');
  }
  async function settle(id, ok) {
    await waitForRequest(id);
    pending.get(id)(ok); pending.delete(id);
  }
  let owned = true;
  const stale = archive.saveAttempt({ practiceMode: 'speak', attemptId: 'departed', promptSnapshot: { promptId: '1' } },
    { shouldPublish: () => owned });
  await waitForRequest('departed');
  owned = false;
  const unrelated = archive.saveAttempt({ practiceMode: 'read-aloud', attemptId: 'unrelated' });
  await settle('departed', true);
  assert.strictEqual((await stale).attemptId, 'departed', 'persisted identity remains available to its caller');
  assert.strictEqual(events.length, 0, 'departed save must not publish a native saved event');
  assert.strictEqual(sandboxWindow.cacheInvalidations, 0, 'departed save must not invalidate shared history');
  await settle('unrelated', true); await unrelated;
  assert.strictEqual(events.length, 1, 'concurrent default callers retain native publication');
  assert.strictEqual(events[0].detail.practiceMode, 'read-aloud');
  assert.strictEqual(sandboxWindow.cacheInvalidations, 1);
  const failed = archive.saveAttempt({ practiceMode: 'speak', attemptId: 'recoverable' }, { shouldPublish: () => true });
  const rejection = assert.rejects(failed, /Save failed/);
  await settle('recoverable', false); await rejection;
  assert.strictEqual(events.length, 1, 'failed save must not publish');
  assert.strictEqual(sandboxWindow.cacheInvalidations, 1, 'failed save must not invalidate');
  const recovery = archive.saveAttempt({ practiceMode: 'speak', attemptId: 'recoverable' }, { shouldPublish: () => true });
  await settle('recoverable', true); await recovery;
  assert.strictEqual(events.length, 2, 'owned recovery publishes once');
  assert.strictEqual(events[1].detail.attemptId, 'recoverable');
  assert.strictEqual(sandboxWindow.cacheInvalidations, 2, 'owned recovery invalidates once');
  assert.ok(requests.every(body => !('shouldPublish' in body)), 'publication ownership is client-local');
}

async function verifyRepeatSentencePublicationContract() {
  const script = fs.readFileSync(path.join(process.cwd(), 'public/script.js'), 'utf8');
  const start = script.indexOf('    async save(resultSnapshot = null) {');
  const end = script.indexOf('    async stop() {', start);
  assert.ok(start > 0 && end > start, 'exercise the actual Repeat Sentence save method');
  const events = [], locals = [], requests = [];
  let rejectNext = false, settle = null, holdNext = false;
  const sandboxWindow = {
    location: { pathname: '/' },
    PracticeScopeManager: { getScope: () => 'pte', subscribe: () => () => {} },
    auth: { currentUser: { getIdToken: async () => 'local-contract-token' } },
    addEventListener: () => {}, dispatchEvent: event => events.push(event), cacheInvalidations: 0,
    PteAttemptHistory: { recordLocal: row => locals.push(row) },
    SpeakingPracticeController: { setSaveError: () => {} }
  };
  const sandbox = {
    window: sandboxWindow, PracticeScopeManager: sandboxWindow.PracticeScopeManager,
    document: { readyState: 'loading', addEventListener: () => {} }, console, URLSearchParams, Blob, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); requests.push({ url, body });
      if (holdNext) { holdNext = false; await new Promise(resolve => { settle = resolve; }); }
      const ok = !rejectNext; rejectNext = false;
      return { ok, status: ok ? 200 : 503,
        json: async () => ok ? { data: { attemptId: body.attemptId || 'rs-contract' } } : { success: false, message: 'Save failed' } };
    }
  };
  const observed = helper.replace('function invalidateHistoryCache() {', 'function invalidateHistoryCache() { window.cacheInvalidations++;');
  vm.createContext(sandbox);
  vm.runInContext(observed, sandbox, { filename: helperPath });
  const mode = vm.runInContext(`({${script.slice(start, end)}})`, sandbox, { filename: 'RepeatSentenceV3.save' });
  let owned = true;
  mode.captureAttemptOwner = () => ({ attempt: mode.attempt });
  mode.ownsAttempt = owner => owned && owner.attempt === mode.attempt;
  const reset = () => {
    events.length = 0; locals.length = 0; requests.length = 0; sandboxWindow.cacheInvalidations = 0;
    mode.attempt = { id: 'rs-contract', promptId: '1', text: 'The library opens.', transcript: 'The library opens.' };
    owned = true;
  };
  const assertPublication = (count, label) => {
    assert.strictEqual(events.length, count, `${label}: saved event count`);
    assert.strictEqual(sandboxWindow.cacheInvalidations, count, `${label}: cache invalidation count`);
    assert.strictEqual(locals.length, 0, `${label}: signed-in save does not publish a guest row`);
  };
  reset(); rejectNext = true;
  await assert.rejects(mode.save(), /Save failed/);
  assertPublication(0, 'raw failure');
  await mode.save({ score: 3, maxScore: 4 });
  assertPublication(1, 'assessed native recovery');
  assert.ok(requests.at(-1).url.endsWith('/save'));
  assert.strictEqual(events[0].detail.attemptId, 'rs-contract');
  reset(); await mode.save();
  assertPublication(1, 'raw native save');
  events.length = 0; sandboxWindow.cacheInvalidations = 0; rejectNext = true;
  await assert.rejects(mode.save({ score: 3, maxScore: 4 }), /Save failed/);
  assertPublication(0, 'patch failure');
  await mode.save();
  assertPublication(1, 'assessed patch recovery');
  assert.ok(requests.at(-1).url.endsWith('/result'));
  for (const patch of [false, true]) {
    reset(); if (patch) mode.attempt.archiveId = 'rs-contract';
    holdNext = true; settle = null;
    const pending = mode.save({ score: 3, maxScore: 4 });
    for (let i = 0; !settle && i < 30; i++) await Promise.resolve();
    assert.ok(settle, 'save reaches the real deferred archive boundary');
    owned = false; settle();
    assert.strictEqual(await pending, false);
    assertPublication(0, `${patch ? 'patch' : 'native'} invalidated lifecycle`);
    assert.ok(!mode.attempt.saved);
  }
  reset();
  sandboxWindow.auth.currentUser = null;
  mode.attempt.blob = new Blob(['local-wave'], { type: 'audio/wav' });
  await mode.save();
  assert.strictEqual(locals.length, 1, 'guest capture publishes one local summary');
  locals.length = 0;
  await mode.save({ score: 3, maxScore: 4 });
  assert.strictEqual(locals.length, 1, 'guest assessment updates the local summary once');
  assert.strictEqual(locals[0].attemptId, mode.attempt.id);
  assert.strictEqual(events.length, 0, 'guest summaries never claim server persistence');
  assert.strictEqual(sandboxWindow.cacheInvalidations, 0, 'guest skips do not invalidate server history');
  assert.strictEqual(requests.length, 0, 'guest audio stays local');
}

verifyAssessedSnapshotPatchContract().then(verifyPublicationOwnershipContract).then(verifyRepeatSentencePublicationContract)
  .then(() => console.log('PTE attempt archive frontend contract test passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
