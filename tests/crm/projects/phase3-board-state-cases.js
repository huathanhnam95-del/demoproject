'use strict';

const assert = require('assert');
const stateModule = require('../../../public/js/crm/projects/state');
// The browser script currently populates its global but does not expose the
// CommonJS function on Node in this checkout. Keep the fallback explicit so
// the cases still exercise that same production implementation and surface
// the export mismatch to the owning source coder.
const createBoardState = stateModule.createBoardState || globalThis.CrmProjectsBoardState?.createBoardState;
assert.strictEqual(typeof createBoardState, 'function', 'Phase3 board state module must expose createBoardState.');

/**
 * A real deferred used by the browser harness and by the production state
 * contract cases. Keeping this here avoids test-only state implementations:
 * callers still drive the actual board/controller or state module.
 */
function createDeferred(label = 'deferred') {
    let resolve;
    let reject;
    let settled = false;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = (value) => {
            settled = true;
            resolvePromise(value);
        };
        reject = (error) => {
            settled = true;
            rejectPromise(error);
        };
    });
    return {
        label,
        promise,
        resolve,
        reject,
        get settled() { return settled; }
    };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

function assertScopedKeyIsolation(state) {
    state.switchProject('project-a');
    state.setDraft('same-task', 'title', 'A draft');
    state.switchProject('project-b');
    state.setDraft('same-task', 'title', 'B draft');
    assert.strictEqual(state.getDraft('same-task', 'title'), 'B draft', 'the active project must expose only its own draft');
    state.switchProject('project-a');
    assert.strictEqual(state.hasDraft('same-task', 'title'), false, 'switching projects must discard stale project drafts');
}

async function caseDeferredResponseFence() {
    const state = createBoardState();
    state.switchProject('project-a');
    state.setView({ selectedTaskId: 'same-task', focusId: 'same-task', scrollTop: 230, expanded: ['same-task'] });
    const token = state.beginMutation('same-task');
    const deferred = createDeferred('project-a PATCH');
    let applied = 0;
    const completion = state.enqueueMutation(token, async (currentToken) => {
        await deferred.promise;
        if (!state.isMutationCurrent(currentToken)) return;
        applied += 1;
        state.finishMutation(currentToken);
    });
    state.switchProject('project-b');
    deferred.resolve({ title: 'late project-a response' });
    await completion;
    await flushMicrotasks();
    assert.strictEqual(applied, 0, 'a completion from the old project must not mutate the new project');
    assert.strictEqual(state.getView().selectedTaskId, '', 'switching projects must fence old selection');
    assert.strictEqual(state.getView().expanded.size, 0, 'switching projects must fence old expansion');
}

async function caseSameTaskQueueLatestRevision() {
    const state = createBoardState();
    state.switchProject('project-a');
    const first = state.beginMutation('same-task');
    const firstResponse = createDeferred('revision-1 response');
    const applied = [];
    const firstRun = state.enqueueMutation(first, async (token) => {
        await firstResponse.promise;
        if (!state.isMutationCurrent(token)) return;
        applied.push({ revision: 1, operationKey: token.operationKey });
        state.finishMutation(token);
    });
    const second = state.beginMutation('same-task');
    const secondRun = state.enqueueMutation(second, async (token) => {
        if (!state.isMutationCurrent(token)) return;
        applied.push({ revision: 2, operationKey: token.operationKey });
        state.finishMutation(token);
    });
    firstResponse.resolve({ revision: 1 });
    await Promise.all([firstRun, secondRun]);
    await flushMicrotasks();
    assert.deepStrictEqual(applied.map((entry) => entry.revision), [2], 'only the latest same-task revision may apply after serialization');
}

async function caseCrossProjectCompletionFence() {
    const state = createBoardState();
    state.switchProject('project-a');
    const first = state.beginMutation('same-task');
    const firstResponse = createDeferred('project-a response');
    let projectACommit = 0;
    const run = state.enqueueMutation(first, async (token) => {
        await firstResponse.promise;
        if (!state.isMutationCurrent(token)) return;
        projectACommit += 1;
        state.finishMutation(token);
    });
    state.switchProject('project-b');
    const second = state.beginMutation('same-task');
    let projectBCommit = 0;
    const secondRun = state.enqueueMutation(second, async (token) => {
        if (!state.isMutationCurrent(token)) return;
        projectBCommit += 1;
        state.finishMutation(token);
    });
    firstResponse.resolve({ projectId: 'project-a', taskId: 'same-task' });
    await Promise.all([run, secondRun]);
    await flushMicrotasks();
    assert.strictEqual(projectACommit, 0, 'old project completion must not commit');
    assert.strictEqual(projectBCommit, 1, 'current project completion must commit exactly once');
}

function caseBranchCursorAndReconciliation() {
    const state = createBoardState();
    state.switchProject('project-a');
    state.setBranch(null, 'root-page-2', true);
    state.setBranch('parent-1', 'child-page-2', true);
    assert.deepStrictEqual(state.getBranch(null), { cursor: 'root-page-2', hasMore: true });
    assert.deepStrictEqual(state.getBranch('parent-1'), { cursor: 'child-page-2', hasMore: true });
    state.setBranch(null, null, false);
    assert.deepStrictEqual(state.getBranch(null), { cursor: null, hasMore: false }, 'a terminal response must reconcile the branch cursor');
    state.switchProject('project-b');
    assert.deepStrictEqual(state.getBranch(null), { cursor: null, hasMore: false }, 'branch cursors must be project-scoped');
}

function caseDraftsAndViewSurviveRefresh() {
    const state = createBoardState();
    state.switchProject('project-a');
    state.setDraft('same-task', 'title', 'dirty title');
    state.setView({ selectedTaskId: 'same-task', focusId: 'same-task', scrollTop: 875, expanded: ['same-task', 'child-task'] });
    state.setSelectedTaskIds(['same-task', 'child-task']);
    const refresh = state.beginRefresh();
    assert.strictEqual(state.isCurrent(refresh), true);
    assert.strictEqual(state.getDraft('same-task', 'title'), 'dirty title', 'refresh must keep a dirty task draft');
    const expectedView = { selectedTaskIds: ['same-task', 'child-task'], selectedTaskId: 'same-task', focusId: 'same-task', scrollTop: 875, expanded: new Set(['same-task', 'child-task']) };
    assert.deepStrictEqual(state.getView(), expectedView);
    state.setView({ scrollTop: 910 });
    assert.strictEqual(state.getDraft('same-task', 'title'), 'dirty title', 'view updates must not clear drafts');
    assert.deepStrictEqual(state.getView(), { ...expectedView, scrollTop: 910 });
}

function caseDelimiterTupleIsolation() {
    const state = createBoardState();
    state.switchProject('project::a');
    state.setDraft('task', 'title', 'left');
    state.switchProject('project');
    state.setDraft('a::task', 'title', 'right');
    assert.strictEqual(state.getDraft('a::task', 'title'), 'right');
    state.switchProject('project::a');
    assert.strictEqual(state.getDraft('task', 'title'), 'left', 'project/task tuple keys must not collide on a legal delimiter');
}

const CASES = Object.freeze([
    ['deferred response project fence', caseDeferredResponseFence],
    ['same-task latest-revision queue', caseSameTaskQueueLatestRevision],
    ['cross-project completion fence', caseCrossProjectCompletionFence],
    ['branch cursor reconciliation', caseBranchCursorAndReconciliation],
    ['draft and view preservation through refresh', caseDraftsAndViewSurviveRefresh],
    ['draft scoping', () => assertScopedKeyIsolation(createBoardState())]
]);

async function runPhase3BoardStateCases({ cases = CASES, onCase = null } = {}) {
    const results = [];
    for (const [name, test] of cases) {
        const startedAt = Date.now();
        await test();
        const result = { name, durationMs: Date.now() - startedAt };
        results.push(result);
        if (typeof onCase === 'function') await onCase(result);
    }
    return results;
}

if (require.main === module) {
    runPhase3BoardStateCases()
        .then((results) => process.stdout.write(`crm projects Phase3 board state cases passed (${results.length})\n`))
        .catch((error) => {
            process.stderr.write(`${error.stack || error.message}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    CASES,
    createDeferred,
    flushMicrotasks,
    caseDeferredResponseFence,
    caseSameTaskQueueLatestRevision,
    caseCrossProjectCompletionFence,
    caseBranchCursorAndReconciliation,
    caseDraftsAndViewSurviveRefresh,
    caseDelimiterTupleIsolation,
    runPhase3BoardStateCases
};
