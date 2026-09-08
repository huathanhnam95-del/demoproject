'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraft } = require('../../../functions/src/crm/data-input/draft-service');
const { createInterpretationService } = require('../../../functions/src/crm/data-input/interpretation-service');
function fixture(generate) {
    const state = { now: 1800000000000, allowed: true, calls: 0 }, rows = new Map();
    const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
    const collection = path => ({ doc: id => ref(`${path}/${id}`) });
    let queue = Promise.resolve();
    const db = { collection, runTransaction(fn) {
        const task = queue.then(async () => { const pending = new Map(); const tx = { get: async r => ({ exists: rows.has(r.path), data: () => structuredClone(rows.get(r.path)) }), set: (r, value) => { if (state.failPath && r.path.includes(state.failPath)) throw Error('Injected persistence failure'); pending.set(r.path, structuredClone(value)); } }; const result = await fn(tx); for (const [path, value] of pending) rows.set(path, value); return result; });
        queue = task.catch(() => {}); return task;
    } };
    rows.set('crmDataInputDrafts/d1', { ...createDraft({ actorUid: 'staff1', draftId: 'd1', now: state.now }), messageIds: [] });
    const options = { db, authorize: async ({ tx }) => { assert.ok(tx); return state.allowed; }, now: () => state.now, provider: { async generate(input) { state.calls++; return generate(input, state, rows); } } };
    return { state, rows, options, service: createInterpretationService(options) };
}
const input = { actorUid: 'staff1', draftId: 'd1', messageId: 'm1', expectedRevision: 0, text: 'Create Lan' };
const output = JSON.stringify({ upserts: [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan' } }], removals: [], questions: [], lookups: [] });

function imageFixture(f) {
    const bytes = Buffer.from('normalized image fixture');
    const attachment = { attachmentId: 'a1', status: 'ready', mimeType: 'image/png', width: 2, height: 2, bytesLength: bytes.length, expiresAtMs: f.state.now + 1000, sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') };
    f.rows.get('crmDataInputDrafts/d1').attachmentIds = ['a1'];
    f.options.provider.supportsImages = true;
    f.options.attachments = { async read(query) { assert.deepEqual(query, { actorUid: 'staff1', draftId: 'd1', attachmentId: 'a1' }); return { attachment, bytes }; } };
    return { attachment, bytes };
}
test('image drafting sends owned bytes once and persists image provenance without image data', async () => {
    const f = fixture(async call => { assert.equal(call.request.image.attachmentId, 'a1'); assert.equal(Buffer.from(call.request.image.inlineData.data, 'base64').toString(), 'normalized image fixture'); return output; });
    imageFixture(f); const service = createInterpretationService(f.options), request = { ...input, attachmentId: 'a1' };
    const result = await service.start(request); assert.equal(result.status, 'done');
    f.options.attachments.read = async () => { throw Error('Replay must not read image again'); };
    assert.deepEqual(await service.start(request), result); assert.equal(f.state.calls, 1);
    await assert.rejects(service.start({ ...request, attachmentId: 'a2' }), error => error.code === 'MESSAGE_CONFLICT');
    const applied = await service.apply(request);
    assert.deepEqual(applied.draft.actions[0].provenance.name, { kind: 'image', messageId: 'm1', attachmentId: 'a1' });
    assert.ok(!JSON.stringify([...f.rows.values()]).includes('inlineData'));
});
test('image support, integrity, ownership and current revision are required before dispatch', async () => {
    for (const mode of ['unsupported', 'corrupt', 'expired', 'foreign', 'stale']) {
        const f = fixture(async () => output), image = imageFixture(f);
        if (mode === 'unsupported') f.options.provider.supportsImages = false;
        if (mode === 'corrupt') image.bytes[0] = 0;
        if (mode === 'expired') image.attachment.expiresAtMs = f.state.now;
        if (mode === 'foreign') f.rows.get('crmDataInputDrafts/d1').attachmentIds = [];
        if (mode === 'stale') { const read = f.options.attachments.read; f.options.attachments.read = async query => { const result = await read(query); f.rows.get('crmDataInputDrafts/d1').revision++; return result; }; }
        await assert.rejects(createInterpretationService(f.options).start({ ...input, attachmentId: 'a1' }));
        assert.equal(f.state.calls, 0, mode); assert.equal(f.rows.size, 1, mode);
    }
});

test('an unmatched lookup can be refined through the canonical resolver without client record values', async () => {
    const f = fixture(async () => output);
    f.rows.get('crmDataInputDrafts/d1').pendingLookups = [{ kind: 'student', field: 'name', value: 'Wrong name' }];
    const context = { resolve: async query => { assert.equal(query.kind, 'student'); assert.deepEqual(query.match, { field: 'email', value: 'lan@example.test' }); return { status: 'resolved', record: { kind: 'student', id: 's1', values: { name: 'Lan' } } }; } };
    const service = createInterpretationService({ ...f.options, context });
    const selections = [{ lookupIndex: 0, match: { field: 'email', value: 'lan@example.test' } }];
    assert.equal((await service.lookups({ ...input, selections })).queries[0].result.record.id, 's1');
    assert.equal(f.state.calls, 0);
    assert.equal((await service.start({ ...input, selections })).status, 'done');
});

test('pending lookups use server context and require explicit selection among ambiguous matches', async () => {
    const record = id => ({ kind: 'student', id, values: { name: 'Lan' } });
    const f = fixture(async request => {
        assert.equal(JSON.parse(request.request.input).resolutions[0].record.id, 's2');
        return JSON.stringify({ upserts: [{ actionId: 'edit', kind: 'updateStudent', values: { studentId: 's2', notes: 'Confirmed' } }], removals: [], questions: [], lookups: [] });
    });
    f.rows.get('crmDataInputDrafts/d1').pendingLookups = [{ kind: 'student', field: 'name', value: 'Lan' }];
    let lookups = 0;
    const context = { resolve: async query => { lookups++; assert.deepEqual(query, { actorUid: 'staff1', kind: 'student', match: { field: 'name', value: 'Lan' } }); return { status: 'ambiguous', candidates: [record('s1'), record('s2')] }; } };
    const service = createInterpretationService({ ...f.options, context });
    assert.equal((await service.lookups(input)).queries[0].result.status, 'ambiguous');
    await assert.rejects(service.start(input), error => error.code === 'LOOKUP_SELECTION_REQUIRED');
    assert.equal(f.state.calls, 0); assert.equal(f.rows.size, 1);
    await assert.rejects(service.start({ ...input, selections: [{ lookupIndex: 0, id: 'unlisted' }] }), error => error.code === 'LOOKUP_SELECTION_REQUIRED');
    const selected = { ...input, selections: [{ lookupIndex: 0, id: 's2' }] };
    const done = await service.start(selected);
    assert.equal(done.status, 'done');
    const count = lookups;
    assert.deepEqual(await service.start(selected), done); assert.equal(lookups, count); assert.equal(f.state.calls, 1);
    await assert.rejects(service.start({ ...input, selections: [{ lookupIndex: 0, id: 's1' }] }), error => error.code === 'MESSAGE_CONFLICT');
    const applied = await service.apply(input);
    assert.equal(applied.draft.actions[0].values.studentId, 's2');
    assert.deepEqual(applied.draft.pendingLookups, []);
});

test('lookup preflight rejects stale drafts, unknown selectors and authorization changes before dispatch', async () => {
    const f = fixture(async () => output);
    f.rows.get('crmDataInputDrafts/d1').pendingLookups = [{ kind: 'student', field: 'name', value: 'Lan' }];
    const context = { resolve: async () => { f.rows.get('crmDataInputDrafts/d1').revision++; return { status: 'resolved', record: { kind: 'student', id: 's1', values: { name: 'Lan' } } }; } };
    const service = createInterpretationService({ ...f.options, context });
    await assert.rejects(service.start({ ...input, selections: [{ lookupIndex: 1, id: 's1' }] }), error => error.code === 'INVALID_SELECTION');
    await assert.rejects(service.start(input), error => error.code === 'REVISION_CONFLICT');
    assert.equal(f.state.calls, 0);
    f.state.allowed = false;
    await assert.rejects(service.lookups({ ...input, expectedRevision: 1 }), error => error.status === 403);
    assert.equal(f.rows.size, 1);
});

test('lookup follow-up retains the original instruction and unique context while only drafting', async () => {
    const f = fixture(async request => {
        if (f.state.calls === 1) return JSON.stringify({ upserts: [], removals: [], questions: [], lookups: [{ kind: 'student', field: 'name', value: 'Lan' }] });
        const payload = JSON.parse(request.request.input);
        assert.deepEqual(payload.currentDraft.pendingInstructions, ['Change Lan notes to agreed schedule']);
        assert.equal(payload.resolutions[0].record.id, 's1');
        return JSON.stringify({ upserts: [{ actionId: 'edit', kind: 'updateStudent', values: { studentId: 's1', notes: 'agreed schedule' } }], removals: [], questions: [], lookups: [] });
    });
    const context = { resolve: async () => ({ status: 'resolved', record: { kind: 'student', id: 's1', values: { name: 'Lan' } } }) };
    const service = createInterpretationService({ ...f.options, context });
    await service.start({ ...input, text: 'Change Lan notes to agreed schedule' });
    await service.apply(input);
    const followup = { ...input, messageId: 'm2', expectedRevision: 1, text: 'Continue with this matching student' };
    assert.equal((await service.start(followup)).status, 'done');
    const applied = await service.apply(followup);
    assert.deepEqual(applied.draft.pendingLookupMessages, []);
    assert.equal(applied.draft.actions[0].values.notes, 'agreed schedule');
    assert.equal([...f.rows.keys()].every(path => path.startsWith('crmDataInputDrafts/')), true);
});

test('missing matches and admission revoked during lookup cannot dispatch or leave a running request', async () => {
    for (const revoke of [false, true]) {
        const f = fixture(async () => output);
        f.rows.get('crmDataInputDrafts/d1').pendingLookups = [{ kind: 'student', field: 'name', value: 'Lan' }];
        const context = { resolve: async () => {
            if (revoke) { f.state.allowed = false; return { status: 'resolved', record: { kind: 'student', id: 's1', values: { name: 'Lan' } } }; }
            return { status: 'not_found', candidates: [] };
        } };
        const service = createInterpretationService({ ...f.options, context });
        await assert.rejects(service.start(input), error => error.code === (revoke ? 'FORBIDDEN' : 'LOOKUP_SELECTION_REQUIRED'));
        assert.equal(f.state.calls, 0); assert.equal(f.rows.size, 1);
    }
});

test('concurrent identical messages dispatch once, persist result and recover after service recreation', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = fixture(async request => { assert.equal(request.feature, 'crm-data-input'); assert.equal(request.actorUid, 'staff1'); await gate; return output; });
    const first = f.service.start(input);
    while (!f.state.calls) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.service.start(input)).status, 'running');
    release();
    const done = await first;
    assert.equal(done.status, 'done'); assert.equal(done.proposal.readyForReview, true);
    assert.deepEqual(await createInterpretationService(f.options).start(input), done);
    assert.deepEqual(await createInterpretationService({ ...f.options, provider: null }).start(input), done);
    assert.equal(done.text, input.text);
    assert.equal(f.state.calls, 1);
    assert.equal(f.rows.get('crmDataInputDrafts/d1').revision, 0);
    assert.equal(f.rows.get('crmDataInputDrafts/d1').actions.length, 0);
});

test('altered duplicate content conflicts rather than redispatching', async () => {
    const f = fixture(async () => output); await f.service.start(input);
    await assert.rejects(f.service.start({ ...input, text: 'Different message' }), error => error.code === 'MESSAGE_CONFLICT');
    assert.equal(f.state.calls, 1);
});

test('uncertain provider responses never cause automatic redispatch', async () => {
    const f = fixture(async () => { throw Error('Private provider detail'); });
    const result = await f.service.start(input);
    assert.equal(result.status, 'unknown');
    assert.equal(JSON.stringify(result).includes('Private provider detail'), false);
    assert.deepEqual(await f.service.start(input), result);
    assert.equal(f.state.calls, 1);
});

test('a concurrent manual edit marks the proposal stale without overwriting the draft', async () => {
    const f = fixture(async (_request, _state, rows) => { rows.get('crmDataInputDrafts/d1').revision = 1; return output; });
    const result = await f.service.start(input);
    assert.equal(result.status, 'stale'); assert.equal(result.proposal.readyForReview, false);
    assert.equal(f.rows.get('crmDataInputDrafts/d1').revision, 1);
});

test('revocation after dispatch prevents result disclosure and another actor cannot recover it', async () => {
    const f = fixture(async (_request, state) => { state.allowed = false; return output; });
    await assert.rejects(f.service.start(input), error => error.status === 403);
    f.state.allowed = true;
    await assert.rejects(f.service.get({ actorUid: 'other', draftId: 'd1', messageId: 'm1' }), error => error.status === 404);
    assert.equal(f.state.calls, 1);
});

test('unavailable transport fails closed and invalid output is recorded as rejected', async () => {
    const f = fixture(async () => '{"confirmation":true}');
    const unavailable = createInterpretationService({ ...f.options, provider: null });
    await assert.rejects(unavailable.start(input), error => error.status === 503);
    assert.equal(f.rows.size, 1);
    assert.equal((await f.service.start(input)).status, 'rejected');
    assert.equal(f.state.calls, 1);
});

test('proposal application atomically updates the draft and message once without another provider call', async () => {
    const f = fixture(async () => output); await f.service.start(input);
    const applied = await f.service.apply(input);
    assert.equal(applied.status, 'applied'); assert.equal(applied.appliedRevision, 1);
    assert.equal(applied.draft.actions[0].values.name, 'Lan');
    assert.deepEqual(applied.draft.messageIds, ['m1']);
    const message = f.rows.get('crmDataInputDrafts/d1/messages/m1');
    assert.equal(message.source.kind, 'text'); assert.equal(message.text, input.text);
    assert.equal((await f.service.apply(input)).draft.revision, 1);
    assert.equal(f.state.calls, 1);
    assert.equal([...f.rows.keys()].every(path => path.startsWith('crmDataInputDrafts/')), true);
});

test('application rejects a proposal after a manual revision and retains pending clarification', async () => {
    const f = fixture(async () => output); await f.service.start(input);
    f.rows.get('crmDataInputDrafts/d1').revision = 1;
    await assert.rejects(f.service.apply(input), error => error.code === 'STALE_PROPOSAL');
    assert.equal(f.rows.get('crmDataInputDrafts/d1').actions.length, 0);
    const q = fixture(async () => JSON.stringify({ ...JSON.parse(output), questions: [{ actionId: 'student', field: 'name', text: 'Confirm the exact spelling.' }] }));
    await q.service.start(input);
    const applied = await q.service.apply(input);
    assert.equal(applied.draft.interpretationQuestions[0].field, 'name');
});

test('application receipt failure rolls back both the draft and conversation message', async () => {
    const f = fixture(async () => output); await f.service.start(input);
    f.state.failPath = '/interpretations/';
    await assert.rejects(f.service.apply(input), /Injected persistence failure/);
    assert.equal(f.rows.get('crmDataInputDrafts/d1').revision, 0);
    assert.equal(f.rows.has('crmDataInputDrafts/d1/messages/m1'), false);
    assert.equal(f.rows.get('crmDataInputDrafts/d1/interpretations/m1').status, 'done');
    f.state.failPath = null;
    assert.equal((await f.service.apply(input)).appliedRevision, 1);
    assert.equal(f.state.calls, 1);
});
