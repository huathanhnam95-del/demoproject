'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto');
const { createProjectsProposalService, nextThursday, PROJECT_AI_PROPOSALS } = require('../../../functions/src/crm/projects/voice/proposal-service');
function fixture(output = { kind: 'planning', text: 'Plan only.' }, options = {}) {
    const records = new Map(), calls = [], mutations = []; let denied = false, role = 'Owner', onGenerate = null;
    const doc = path => ({ path, collection: name => collection(`${path}/${name}`) });
    const collection = path => ({ path, query: true, doc: key => doc(`${path}/${key}`), limit: () => collection(path) });
    const db = { collection, doc, async runTransaction(work) { const writes = []; const result = await work({ async get(ref) { if (ref.query) return { docs: [...records].filter(([key]) => key.startsWith(`${ref.path}/`) && key.split('/').length === ref.path.split('/').length + 1).map(([key, value]) => ({ id: key.split('/').pop(), exists: true, data: () => structuredClone(value) })) }; return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) }; }, create(ref, value) { writes.push(() => { assert.ok(!records.has(ref.path)); records.set(ref.path, value); }); }, set(ref, value, opts) { writes.push(() => records.set(ref.path, opts?.merge ? { ...records.get(ref.path), ...value } : value)); } }); writes.forEach(write => write()); return result; } };
    const context = { project: { id: 'p' }, selectedTaskIds: ['t'], tasks: [{ id: 't' }], columns: [], people: { members: [{ uid: 'mai1', displayName: 'Mai', role: 'Editor' }], incomplete: false } };
    const accessService = { async assertTransactionEligible(tx, actorUid) { return { uid: actorUid, profile: {} }; }, async assertTransactionContentAccess(tx, actorUid, projectId, access) { calls.push({ access, actorUid, projectId }); if (denied || access.owner && role !== 'Owner' || access.write && role === 'Viewer') throw Object.assign(Error('Denied'), { status: 403 }); return { identity: { uid: actorUid, profile: {} }, project: { data: { lifecycle: 'active' } } }; } };
    const draft = { draftId: 'd', scope: { projectId: 'p' }, revision: 2, actions: [{ actionId: 'a1', kind: 'field_update', taskId: 't', patch: { title: 'old' } }, { actionId: 'a2', kind: 'field_update', taskId: 'other', patch: { title: 'preserved' } }] };
    const draftService = { voiceAdapter: { async resolveContext({ contextHints }) { if (contextHints.selectedTaskIds?.includes('missing')) throw Object.assign(Error('Missing'), { status: 404 }); return { context: structuredClone(context) }; } }, async read() { if (denied) throw Object.assign(Error('Denied'), { status: 403 }); return { draft }; }, async createFromProposal(identity, projectId, input) { mutations.push({ kind: 'create', identity, projectId, input }); return { draft: { ...draft, actions: input.actions } }; }, async correct(identity, draftId, input) { mutations.push({ kind: 'correct', identity, draftId, input }); return { draft: { ...draft, revision: 3 } }; } };
    const requests = [];
    const provider = { async generate(input) { requests.push(input); if (onGenerate) await onGenerate(); return typeof output === 'string' ? output : JSON.stringify(output); } };
    const service = createProjectsProposalService({ db, accessService, draftService, ...(options.native ? {} : { provider }), now: () => Date.parse('2026-09-09T17:00:00Z') });
    const input = { requestId: 'request', contextHints: { projectId: 'p', selectedTaskIds: ['t'] }, instruction: 'Help plan.', purpose: 'planning' };
    return { db, accessService, draftService, provider, propose: patch => service.propose({ uid: 'staff' }, { ...input, ...patch }), records, requests, mutations, context, draft, calls, deny: () => { denied = true; }, role: next => { role = next; }, onGenerate: callback => { onGenerate = callback; } };
}
async function enabled(work) { const previous = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = 'true'; try { await work(); } finally { if (previous === undefined) delete process.env.CRM_PROJECTS_ENABLED; else process.env.CRM_PROJECTS_ENABLED = previous; } }
function ordered(value) { return Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value; }
test('full descriptor digest matches bridge ordering; exact replay reauthorizes without generating twice', () => enabled(async () => {
    const f = fixture(); assert.equal((await f.propose()).kind, 'planning'); const call = f.requests[0]; assert.equal(call.actorUid, 'staff'); assert.equal(call.operationId, 'request'); assert.equal(call.feature, 'projects'); assert.equal(call.request.model, 'gemini-3.8-flash');
    const { requestDigest, ...descriptor } = call.request; assert.equal(requestDigest, crypto.createHash('sha256').update(JSON.stringify(ordered(descriptor))).digest('hex')); assert.match(descriptor.systemInstruction, /untrusted/); assert.equal((await f.propose()).replayed, true); assert.equal(f.requests.length, 1);
    await assert.rejects(() => f.propose({ instruction: 'Different' }), error => error.code === 'PROPOSAL_REQUEST_CONFLICT'); f.deny(); await assert.rejects(() => f.propose()); assert.equal(f.requests.length, 1); assert.ok([...f.records.keys()][0].startsWith(PROJECT_AI_PROPOSALS));
}));
test('duplicate or missing Mai clarifies without choosing a UID or creating a draft', () => enabled(async () => {
    for (const people of [[], [{ uid: 'x', displayName: 'Mai' }, { uid: 'y', displayName: 'MAI' }]]) { const f = fixture({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 't', patch: {}, assigneeName: 'Mai' }] }); f.context.people = { members: people, incomplete: false }; assert.equal((await f.propose({ purpose: 'task_draft' })).kind, 'clarification'); assert.equal(f.mutations.length, 0); }
}));
test('unique owner and strictly-next Vietnam Thursday are explicit and helper fields never enter draft', () => enabled(async () => {
    const f = fixture({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 't', patch: { assigneeUids: ['other'] }, assigneeName: 'mAI', dueDateExpression: 'next Thursday' }] }); const result = await f.propose({ purpose: 'task_draft' }); const action = f.mutations[0].input.actions[0]; assert.equal(action.patch.ownerUid, 'mai1'); assert.deepEqual(action.patch.assigneeUids, ['other']); assert.equal(action.patch.dueDate, '2026-09-17'); assert.equal(action.assigneeName, undefined); assert.match(result.notices.join(' '), /Accountable owner.*2026-09-17/);
    assert.equal(nextThursday(Date.parse('2026-09-09T16:59:59Z')), '2026-09-10'); assert.equal(nextThursday(Date.parse('2026-09-09T17:00:00Z')), '2026-09-17');
}));
test('correction targets only supplied action/current revision, with nested patch and stable request', () => enabled(async () => {
    const f = fixture({ kind: 'correction', patch: { patch: { title: 'corrected' } } }); await f.propose({ purpose: 'task_correction', draftId: 'd', actionId: 'a1', expectedRevision: 2 }); assert.deepEqual(f.mutations[0].input, { requestId: 'request', actionId: 'a1', expectedRevision: 2, patch: { patch: { title: 'corrected' } } }); assert.equal(f.draft.actions[1].patch.title, 'preserved');
    const stale = fixture(); await assert.rejects(() => stale.propose({ purpose: 'task_correction', draftId: 'd', actionId: 'a1', expectedRevision: 1 })); assert.equal(stale.requests.length, 0);
}));
test('strict input/output, selected-task bounds and default native gate fail closed', () => enabled(async () => {
    const f = fixture(); for (const patch of [{ actions: [] }, { model: 'other' }, { source: 'user_audio' }, { instruction: 'x'.repeat(8001) }]) await assert.rejects(() => f.propose(patch)); assert.equal(f.requests.length, 0);
    for (const output of ['not JSON', { kind: 'planning', text: 'okay', attestationId: 'forged' }, { kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 'unselected', patch: {} }] }]) { const g = fixture(output); await assert.rejects(() => g.propose({ purpose: typeof output === 'object' && output.kind === 'task_draft' ? 'task_draft' : 'planning' })); assert.equal(g.mutations.length, 0); }
    const native = fixture(undefined, { native: true }); await assert.rejects(() => native.propose(), error => error.code === 'PAID_DISPATCH_DISABLED'); await assert.rejects(() => native.propose(), error => error.code === 'PAID_DISPATCH_DISABLED'); assert.equal([...native.records.values()][0].status, 'disabled');
}));
test('concurrent/crash receipt never redispatches; revocation after generation prevents result persistence', () => enabled(async () => {
    const f = fixture(); let release, started; const ready = new Promise(resolve => { started = resolve; }); f.onGenerate(() => { started(); return new Promise(resolve => { release = resolve; }); }); const pending = f.propose(); await ready; await assert.rejects(() => f.propose(), error => error.code === 'RESPONSE_RECOVERY_REQUIRED'); release(); await pending; assert.equal(f.requests.length, 1);
    const revoked = fixture(); revoked.onGenerate(() => revoked.deny()); await assert.rejects(() => revoked.propose()); assert.equal([...revoked.records.values()][0].status, 'pending'); assert.equal(revoked.mutations.length, 0);
}));
test('automation purpose requires Owner and returns validated editor draft with no rule activation', () => enabled(async () => {
    const definition = { schemaVersion: 1, trigger: { type: 'task_created' }, steps: [{ nodeId: 'step1', type: 'set_field', payload: { patch: { title: 'planned' } } }] };
    const f = fixture({ kind: 'automation_draft', definition }); const result = await f.propose({ purpose: 'automation_draft' }); assert.equal(result.requiresEditorReview, true); assert.equal(f.mutations.length, 0); assert.ok([...f.records.keys()].every(key => key.startsWith(PROJECT_AI_PROPOSALS)));
    const denied = fixture(); denied.role('Editor'); await assert.rejects(() => denied.propose({ purpose: 'automation_draft' })); assert.equal(denied.requests.length, 0);
}));

test('real Projects draft service owns stable action IDs and targeted correction preserves the second action', () => enabled(async () => {
    const { createProjectsDraftService } = require('../../../functions/src/crm/projects/voice/draft-service');
    const f = fixture(); f.context.tasks.push({ id: 'other' });
    const real = createProjectsDraftService({ db: f.db, accessService: f.accessService, commandService: { runCommand() { assert.fail('Proposal cannot apply'); } }, recoveryService: { prepareFieldBatch() { assert.fail('Proposal cannot flush'); }, prepareMoveBatch() { assert.fail('Proposal cannot move'); } }, now: () => 1800000000000 });
    const outputs = [{ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 't', patch: { title: 'first' } }, { kind: 'field_update', taskId: 'other', patch: { title: 'second preserved' } }] }, { kind: 'correction', patch: { patch: { title: 'corrected first' } } }]; let sends = 0;
    const service = createProjectsProposalService({ db: f.db, accessService: f.accessService, draftService: { ...real, voiceAdapter: f.draftService.voiceAdapter }, provider: { async generate() { return JSON.stringify(outputs[sends++]); } }, now: () => 1800000000000 });
    const identity = { uid: 'staff' }, input = { requestId: 'real_create', contextHints: { projectId: 'p', selectedTaskIds: ['t', 'other'] }, instruction: 'Draft changes.', purpose: 'task_draft' };
    const created = await service.propose(identity, input); assert.equal(created.draft.actions.length, 2);
    const originalIds = created.draft.actions.map(action => action.actionId); originalIds.forEach(value => assert.match(value, /^action-[a-f0-9]{24}$/));
    assert.deepEqual((await service.propose(identity, input)).draft.actions.map(action => action.actionId), originalIds); assert.equal(sends, 1);
    const corrected = await service.propose(identity, { ...input, requestId: 'real_correct', purpose: 'task_correction', draftId: created.draft.draftId, actionId: originalIds[0], expectedRevision: created.draft.revision });
    assert.deepEqual(corrected.draft.actions.map(action => action.actionId), originalIds); assert.equal(corrected.draft.actions[0].patch.title, 'corrected first'); assert.deepEqual(corrected.draft.actions[1], created.draft.actions[1]);
    const persisted = await real.read(identity, created.draft.draftId); assert.deepEqual(persisted.actions, corrected.draft.actions);
}));

test('bounded current people DTO cannot establish a unique name when directory is incomplete', () => enabled(async () => {
    const f = fixture({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 't', patch: {}, assigneeName: 'Mai' }] });
    f.context.people.incomplete = true;
    const result = await f.propose({ purpose: 'task_draft' }); assert.equal(result.kind, 'clarification'); assert.equal(f.mutations.length, 0);
}));

test('post-generation cloned context detects renamed or remapped people before any draft decision', () => enabled(async () => {
    const f = fixture({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 't', assigneeName: 'Mai' }] });
    f.onGenerate(() => { f.context.people.members = [{ uid: 'different', displayName: 'Mai', role: 'Editor' }]; });
    await assert.rejects(() => f.propose({ purpose: 'task_draft' }), error => error.code === 'CONTEXT_CHANGED'); assert.equal(f.mutations.length, 0); assert.equal([...f.records.values()][0].status, 'pending');
}));
test('automation validates actual current targets and project members, not definition shape alone', () => enabled(async () => {
    for (const payload of [{ target: { taskId: 'missing' }, patch: { title: 'new' } }, { patch: { ownerUid: 'outsider' } }]) {
        const f = fixture({ kind: 'automation_draft', definition: { schemaVersion: 1, trigger: { type: 'task_created' }, steps: [{ nodeId: 'step', type: 'set_field', payload }] } });
        await assert.rejects(() => f.propose({ purpose: 'automation_draft' }), error => ['TASK_NOT_FOUND', 'BROKEN_REFERENCE'].includes(error.code)); assert.equal(f.mutations.length, 0); assert.equal([...f.records.values()][0].status, 'pending');
    }
}));
test('validated create/correction recover failures before and after real draft commits without another generation', () => enabled(async () => {
    const { createProjectsDraftService } = require('../../../functions/src/crm/projects/voice/draft-service');
    for (const failureStage of ['before', 'after', 'receipt']) {
        const f = fixture(); const real = createProjectsDraftService({ db: f.db, accessService: f.accessService, commandService: { runCommand() { assert.fail('No apply'); } }, recoveryService: { prepareFieldBatch() {}, prepareMoveBatch() {} }, now: () => 1800000000000 });
        let armed = true, sends = 0, output = { kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 't', patch: { title: 'first' } }] };
        const wrapped = { ...real, voiceAdapter: f.draftService.voiceAdapter };
        for (const method of ['createFromProposal', 'correct']) wrapped[method] = async (...args) => {
            if (armed && failureStage === 'before') { armed = false; throw Error('Before draft write'); }
            const result = await real[method](...args);
            if (armed && failureStage === 'after') { armed = false; throw Error('After draft commit'); }
            return result;
        };
        if (failureStage === 'receipt') {
            const original = f.db.runTransaction.bind(f.db);
            f.db.runTransaction = work => original(tx => work(new Proxy(tx, { get(target, key) { if (key === 'set') return (ref, value, options) => { if (armed && ref.path.startsWith(PROJECT_AI_PROPOSALS) && value.status === 'complete') { armed = false; throw Error('Before final receipt commit'); } return target.set(ref, value, options); }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } })));
        }
        const service = createProjectsProposalService({ db: f.db, accessService: f.accessService, draftService: wrapped, provider: { async generate() { sends += 1; return JSON.stringify(output); } }, now: () => 1800000000000 });
        const actor = { uid: 'staff' }, input = { requestId: 'recover_create', contextHints: { projectId: 'p', selectedTaskIds: ['t'] }, instruction: 'Create draft.', purpose: 'task_draft' };
        await assert.rejects(() => service.propose(actor, input)); assert.equal([...f.records.values()].filter(row => row.status === 'validated').length, 1);
        const created = await service.propose(actor, input); assert.equal(created.replayed, true); assert.equal(sends, 1); assert.equal(created.draft.revision, 0);
        assert.equal([...f.records.keys()].filter(key => key.startsWith('crmAiDrafts/')).length, 1);
        armed = true; output = { kind: 'correction', patch: { patch: { title: 'corrected' } } };
        const correction = { ...input, requestId: 'recover_correct', purpose: 'task_correction', draftId: created.draft.draftId, actionId: created.draft.actions[0].actionId, expectedRevision: 0 };
        await assert.rejects(() => service.propose(actor, correction)); const corrected = await service.propose(actor, correction);
        assert.equal(corrected.draft.revision, 1); assert.equal(sends, 2); assert.equal((await real.read(actor, created.draft.draftId)).revision, 1);
        assert.equal([...f.records.keys()].filter(key => key.startsWith('crmAiDraftRevisions/')).length, 2);
        assert.equal([...f.records.values()].filter(row => row.status === 'complete').length, 2);
    }
}));

test('creation proposals require explicit scope, visible destinations and model cannot choose IDs', () => enabled(async () => {
    const create = fixture({ kind: 'task_draft', actions: [{ kind: 'create_project', project: { name: 'September', description: 'Launch' } }] });
    const result = await create.propose({ purpose: 'task_draft', contextHints: { mode: 'create_project' } }); assert.equal(result.kind, 'task_draft'); assert.deepEqual(create.requests[0].context, { mode: 'create_project' }); assert.deepEqual(create.mutations[0].projectId, { mode: 'create_project' });
    const wrong = fixture({ kind: 'task_draft', actions: [{ kind: 'create_project', project: { name: 'Bad scope' } }] }); await assert.rejects(() => wrong.propose({ purpose: 'task_draft' }), { code: 'INVALID_ACTIONS' }); assert.equal(wrong.mutations.length, 0);
    for (const action of [{ kind: 'create_task', task: { title: 'New' }, sectionId: 'missing' }, { kind: 'create_task', task: { title: 'New', taskId: 'forged' }, sectionId: 's' }, { kind: 'create_task', task: { title: 'New' }, sectionId: 's', parentTaskId: 't' }]) { const f = fixture({ kind: 'task_draft', actions: [action] }); f.context.sections = [{ id: 's' }]; await assert.rejects(() => f.propose({ purpose: 'task_draft' })); assert.equal(f.mutations.length, 0); }
    const task = fixture({ kind: 'task_draft', actions: [{ kind: 'create_task', task: { title: 'New' }, sectionId: 's' }] }); task.context.sections = [{ id: 's' }]; await task.propose({ purpose: 'task_draft' }); assert.equal(task.mutations[0].input.actions[0].task.title, 'New');
}));
test('project metadata proposal requires Owner and rejects lifecycle changes', () => enabled(async () => {
    const f = fixture({ kind: 'task_draft', actions: [{ kind: 'update_project', patch: { name: 'Renamed' } }] }); f.role('Editor'); await assert.rejects(() => f.propose({ purpose: 'task_draft' })); assert.equal(f.mutations.length, 0);
    const g = fixture({ kind: 'task_draft', actions: [{ kind: 'update_project', patch: { name: 'Renamed', lifecycle: 'trashed' } }] }); await assert.rejects(() => g.propose({ purpose: 'task_draft' })); assert.equal(g.mutations.length, 0);
}));
