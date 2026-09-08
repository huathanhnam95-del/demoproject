'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = { window: {}, URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/data-input/workspace.js'), 'utf8'), context);
const { safeLink, parseValue } = context.window.CrmDataInputWorkspace;

test('review displays both server phrases as literal text without inventing alternatives', () => {
    const children = [], host = { append: element => children.push(element), ownerDocument: { createElement: tag => ({ tag }) } };
    context.window.CrmDataInputWorkspace.appendVoiceConfirmations(host, { confirmationPhrase: 'Tôi xác nhận lưu bản xem trước số 7', confirmationPhraseEnglish: 'I confirm saving preview number 7' });
    assert.deepEqual(children.map(item => item.textContent), ['Voice confirmation: Tôi xác nhận lưu bản xem trước số 7', 'Voice confirmation (English): I confirm saving preview number 7']);
    children.length = 0;
    context.window.CrmDataInputWorkspace.appendVoiceConfirmations(host, { confirmationPhrase: '<b>literal</b>' });
    assert.equal(children.length, 1); assert.equal(children[0].textContent, 'Voice confirmation: <b>literal</b>');
    assert.equal(children[0].innerHTML, undefined);
});

test('voice bridge removes displayed preview on dirty edits and rejects unsaved or changed-account confirmations', async () => {
    let dirty = false, uid = 'staff1', calls = 0, contexts = 0;
    const state = { uid, draft: { draftId: 'd1', revision: 1 } };
    const client = { getState: () => state, getVoiceHints: () => ({ draftId: 'd1', previewId: 'p1' }), commitVoice: async () => { calls++; return { status: 'committed' }; } };
    const bridge = context.window.CrmDataInputWorkspace.createVoiceBridge({ client, getUid: () => uid, isDirty: () => dirty, transport: { async updateContext() { contexts++; } } });
    assert.equal(bridge.getContext().previewId, 'p1'); await bridge.sync(); assert.equal(contexts, 1);
    await bridge.sync(); assert.equal(contexts, 1);
    dirty = true; assert.equal(bridge.getContext().previewId, undefined); await bridge.sync(); assert.equal(contexts, 2);
    await assert.rejects(bridge.confirm({}, { actorUid: uid }), /unsaved|review/i); assert.equal(calls, 0);
    dirty = false; uid = 'other'; await assert.rejects(bridge.confirm({}, { actorUid: 'staff1' }), /account/i); assert.equal(calls, 0);
    uid = 'staff1'; assert.equal((await bridge.confirm({}, { actorUid: uid })).status, 'committed'); assert.equal(calls, 1);
});

test('record label reloads are deduplicated, sequential and cannot leak across accounts', async () => {
    let uid = 'staff1', release, calls = [];
    const gate = new Promise(done => { release = done; });
    const resolver = context.window.CrmDataInputWorkspace.createRecordLabelResolver({ getUid: () => uid, format: record => record.values.name,
        request: async (_url, options) => { const query = JSON.parse(options.body); calls.push(query); await gate; return { status: 'resolved', record: { ...query, values: { name: 'Teacher Lan' } } }; } });
    const first = resolver.resolve('teacher', 't1');
    const duplicate = resolver.resolve('teacher', 't1');
    const queued = resolver.resolve('teacher', 't2');
    await Promise.resolve(); assert.equal(calls.length, 1);
    uid = 'staff2'; resolver.clear(); release();
    assert.equal(await first, null); assert.equal(await duplicate, null); assert.equal(await queued, null);
    assert.equal(calls.length, 1);
    assert.equal(await resolver.resolve('teacher', 't1'), 'Teacher Lan');
    assert.equal(await resolver.resolve('teacher', 't1'), 'Teacher Lan');
    assert.equal(calls.length, 2);
});

test('record labels reject missing or mismatched context and tolerate lookup failure', async () => {
    for (const response of [{ status: 'not_found' }, { status: 'resolved', record: { kind: 'teacher', id: 'wrong', values: { name: 'Wrong' } } }, new Error('offline')]) {
        const resolver = context.window.CrmDataInputWorkspace.createRecordLabelResolver({ getUid: () => 'staff1', format: record => record.values.name, request: async () => { if (response instanceof Error) throw response; return response; } });
        assert.equal(await resolver.resolve('teacher', 't1'), null);
    }
});

test('BEL starts the new controller only after explicit server enablement and ignores late account responses', async () => {
    const code = fs.readFileSync(path.join(__dirname, '../../../public/js/crm/bel-assistant.js'), 'utf8');
    for (const mode of ['off', 'on', 'changed', 'failed']) {
        let uid = 'staff1', starts = 0, resolve;
        const gate = new Promise(done => { resolve = done; });
        const win = { CrmDataInputWorkspace: { createController: () => ({ init: () => { starts++; }, dispose() {}, onRouteChange() {} }) } };
        vm.runInNewContext(code, { window: win });
        const launcher = { disabled: false, hidden: false, title: '' };
        const controller = win.CrmBelAssistant.createController({ elements: { belChatLauncher: launcher }, getUid: () => uid, request: async () => { await gate; if (mode === 'failed') throw Error('Offline'); return { drafts: mode !== 'off' }; } });
        const initializing = controller.init();
        assert.equal(starts, 0); assert.equal(launcher.disabled, true);
        if (mode === 'changed') uid = 'other';
        resolve(); await initializing;
        assert.equal(starts, mode === 'on' ? 1 : 0);
        assert.equal(launcher.disabled, mode !== 'on');
        controller.dispose();
    }
});
test('correction messages identify the step and field in human language', () => {
    const messages = context.window.CrmDataInputWorkspace.validationMessages({ issues: [{ actionId: 'lead', field: 'dateOfBirth', code: 'CLARIFY_DATE' }, { actionId: 'lead', field: 'source', code: 'REQUIRED_FIELD' }] }, [{ actionId: 'lead', kind: 'createLead' }]);
    assert.match(messages[0], /Step 1.*Date of Birth.*YYYY-MM-DD/i);
    assert.match(messages[1], /Step 1.*Source.*required/i);
});
test('receipt links permit local application links and reject executable or foreign destinations', () => {
    const origin = 'http://localhost:9270';
    assert.equal(safeLink('/crm-admin.html#students/a0001', origin), `${origin}/crm-admin.html#students/a0001`);
    assert.equal(safeLink('/entrance-test.html?token=abc', origin), `${origin}/entrance-test.html?token=abc`);
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://other.example/test', '//other.example', 'https://localhost:9270/test']) assert.equal(safeLink(value, origin), null);
});
test('typed editor values preserve decimal payments and optional missing fields', () => {
    assert.equal(parseValue('number', '10.25'), 10.25);
    assert.equal(parseValue('number', ''), null);
    assert.equal(parseValue('text', ' Lan '), 'Lan');
    assert.equal(JSON.stringify(parseValue('list', 'Monday, Wednesday')), '["Monday","Wednesday"]');
    assert.throws(() => parseValue('number', 'not a number'), /number/i);
});

async function spokenFixture(mode = 'create', continuation = false) {
    const browser = { window: {}, crypto: globalThis.crypto };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/data-input/client.js'), 'utf8'), browser);
    const f = { uid: 'staff1', navigation: 'leads', calls: [], draft: null, generations: 0, dirty: false, selections: [], controller: new AbortController() };
    const client = browser.window.CrmDataInputClient.createClient({ getUid: () => f.uid, request: async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null; f.calls.push({ url, body });
        if (url.endsWith('/capabilities')) return { drafts: true, interpretation: true, voice: true };
        if (url.endsWith('/conversations')) return (f.draft = { draftId: 'spoken-draft', actorUid: f.uid, revision: 0, status: 'draft', actions: [] });
        if (url.endsWith('/interpretations')) {
            f.generations++; f.interpretation = { messageId: body.messageId, text: body.text, status: mode === 'unknown' ? 'unknown' : 'done' };
            return f.interpretation;
        }
        if (url.endsWith('/apply')) {
            f.draft.revision++;
            f.draft.pendingLookups = ['edit', 'clarified', 'ambiguous', 'loop'].includes(mode) && (f.generations === 1 || mode === 'loop') ? [{ kind: 'student', field: 'name', value: 'Lan' }] : [];
            f.draft.actions = f.draft.pendingLookups.length ? [] : [{ actionId: 'a1', kind: ['edit', 'clarified'].includes(mode) ? 'updateStudent' : 'createLead', values: ['edit', 'clarified'].includes(mode) ? { studentId: 'student-lan', phone: '0900000001' } : { name: 'Lan' } }];
            f.draft.interpretationQuestions = mode === 'question' ? [{ text: 'Which phone number should be used?' }] : [];
            if (mode === 'canceled') f.controller.abort(); if (mode === 'dirty') f.dirty = true;
            if (mode === 'navigation') f.navigation = 'students';
            return { ...f.interpretation, status: 'applied', appliedRevision: f.draft.revision, draft: f.draft };
        }
        if (url.endsWith('/lookups')) return { revision: f.draft.revision, queries: [{ lookupIndex: 0, result: { status: mode === 'ambiguous' ? 'ambiguous' : mode === 'clarified' ? 'not_found' : 'resolved', record: { kind: 'student', id: 'student-lan', values: { name: 'Lan' } } } }] };
        if (url.endsWith('/preview')) return { previewId: 'preview-spoken', revision: f.draft.revision, review: { paymentAssertions: [] } };
        if (url.endsWith('/voice-context')) return { confirmationPhrase: 'Tôi xác nhận lưu bản xem trước', previewBinding: { actorUid: f.uid, draftId: f.draft.draftId, revision: f.draft.revision, previewId: 'preview-spoken' } };
        throw Error(`Unexpected request ${url}`);
    } });
    await client.capabilities();
    f.client = client; f.context = { actorUid: f.uid, signal: f.controller.signal };
    const options = { client, getUid: () => f.uid, getSelections: () => f.selections, getNavigationKey: () => f.navigation, isDirty: () => f.dirty, saveDraft: async () => { if (f.beforeSave) await f.beforeSave(); } };
    if (continuation) {
        f.pipeline = context.window.CrmDataInputWorkspace.createInstructionPipeline(options);
        f.handler = f.pipeline.spoken;
    } else f.handler = context.window.CrmDataInputWorkspace.createSpokenInstructionHandler(options);
    return f;
}

test('spoken instruction uses the real client to create an empty draft then generate and display a preview without saving', async () => {
    const f = await spokenFixture();
    assert.equal((await f.handler('Tạo yêu cầu tư vấn cho Lan', f.context)).status, 'review');
    assert.equal(f.client.getState().draft.actions[0].kind, 'createLead'); assert.equal(f.client.getVoiceHints().previewId, 'preview-spoken');
    assert.equal(f.generations, 1); assert.equal(f.calls.filter(call => call.url.endsWith('/preview')).length, 1);
    assert.equal(f.calls.some(call => call.url.endsWith('/commit')), false);
});

test('unique record lookup can continue a spoken edit once; ambiguous matches and repeated lookups stay for clarification', async () => {
    const edited = await spokenFixture('edit');
    assert.equal((await edited.handler('Đổi số điện thoại của Lan', edited.context)).status, 'review');
    assert.equal(edited.generations, 2); assert.equal(edited.client.getState().draft.actions[0].values.studentId, 'student-lan');
    for (const mode of ['ambiguous', 'loop']) {
        const f = await spokenFixture(mode); assert.equal((await f.handler('Sửa thông tin của Lan', f.context)).status, 'needs_input');
        assert.equal(f.generations, mode === 'loop' ? 2 : 1); assert.equal(f.calls.some(call => call.url.endsWith('/preview')), false);
        assert.ok(f.client.getState().draft.pendingLookups.length);
    }
});

test('questions, uncertain interpretation and intervening local edits never produce an automatic preview or commit', async () => {
    for (const mode of ['question', 'unknown', 'dirty']) {
        const f = await spokenFixture(mode), result = await f.handler('Tạo Lan', f.context);
        assert.equal(result.status, mode === 'dirty' ? 'needs_review' : 'needs_input');
        assert.equal(f.calls.some(call => /\/(preview|commit)$/.test(call.url)), false);
        if (mode === 'question') assert.ok(f.client.getState().draft.interpretationQuestions.length);
        if (mode === 'unknown') { await assert.rejects(f.handler('Try again', f.context), /status/i); assert.equal(f.generations, 1); }
    }
});

test('spoken processing fences changed actor, canceled operation and concurrent final callbacks', async () => {
    const changed = await spokenFixture(); changed.beforeSave = async () => { changed.uid = 'staff2'; };
    await assert.rejects(changed.handler('Tạo Lan', changed.context), /account/i); assert.equal(changed.generations, 0);
    const canceled = await spokenFixture('canceled');
    await assert.rejects(canceled.handler('Tạo Lan', canceled.context), /stopped|canceled/i);
    assert.equal(canceled.calls.some(call => call.url.endsWith('/preview')), false);
    const navigated = await spokenFixture('navigation'); await assert.rejects(navigated.handler('Tạo Lan', navigated.context), /changed/i);
    assert.equal(navigated.calls.some(call => call.url.endsWith('/preview')), false);
    const f = await spokenFixture(); let release; f.beforeSave = () => new Promise(resolve => { release = resolve; });
    const pending = f.handler('Tạo Lan', f.context);
    await assert.rejects(f.handler('Duplicate', f.context), /already|progress/i); release(); await pending;
    assert.equal(f.generations, 1);
});

test('explicit selected-record continuation shares automatic review and never saves', async () => {
    const f = await spokenFixture('clarified', true);
    assert.equal((await f.handler('Edit the existing student', f.context)).status, 'needs_input');
    assert.equal(f.generations, 1); assert.equal(f.client.getState().preview, null);
    f.selections = [{ lookupIndex: 0, match: { field: 'name', value: 'Lan' }, id: 'student-lan' }];
    assert.equal((await f.pipeline.continueInstruction()).status, 'review');
    const requests = f.calls.filter(call => call.url.endsWith('/interpretations'));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].body.selections, f.selections);
    assert.match(requests[1].body.text, /Continue the pending instruction/);
    assert.equal(f.client.getState().draft.actions[0].values.studentId, 'student-lan');
    assert.equal(f.calls.filter(call => call.url.endsWith('/preview')).length, 1);
    assert.equal(f.calls.some(call => call.url.endsWith('/commit')), false);
});

test('explicit continuation preserves questions, dirty state, actor and navigation fences and shares voice concurrency', async () => {
    for (const mode of ['question', 'unknown', 'dirty', 'ambiguous', 'loop']) {
        const f = await spokenFixture(mode, true);
        const result = await f.pipeline.continueInstruction('Resolve the current instruction');
        assert.ok(['needs_input', 'needs_review'].includes(result.status));
        assert.equal(f.calls.some(call => /\/(preview|commit)$/.test(call.url)), false);
    }
    const changed = await spokenFixture('create', true);
    changed.beforeSave = async () => { changed.uid = 'other'; };
    await assert.rejects(changed.pipeline.continueInstruction('Continue'), /account/i);
    assert.equal(changed.generations, 0);
    const navigated = await spokenFixture('navigation', true);
    await assert.rejects(navigated.pipeline.continueInstruction('Continue'), /changed/i);
    assert.equal(navigated.calls.some(call => call.url.endsWith('/preview')), false);
    const f = await spokenFixture('create', true); let release;
    f.beforeSave = () => new Promise(resolve => { release = resolve; });
    const active = f.handler('Spoken instruction', f.context);
    await assert.rejects(f.pipeline.continueInstruction('Continue'), /already|progress/i);
    release(); await active; assert.equal(f.generations, 1);
});
