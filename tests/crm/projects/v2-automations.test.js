'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
async function fixture() {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://fixture.invalid/crm-admin.html?keep=yes#projects' });
    const w = dom.window; w.TextEncoder = TextEncoder; w.document.querySelector('[data-panel="projects"]').dataset.projectsUi = 'v2';
    for (const name of ['automation-definition-editor', 'automations-renderer', 'automations', 'presentation/shell']) w.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    w.eval(fs.readFileSync(path.join(root, 'tests/fixtures/crm/projects-v2-automations.js'), 'utf8'));
    const h = await w.createProjectsAutomationsFixture();
    return Object.assign(h, { w, doc: w.document, close: () => { h.shell.dispose(); w.close(); } });
}
const state = h => h.controller.getState();
const button = (h, action) => h.doc.querySelector(`[data-auto-action="${action}"]`);
const writes = h => h.calls.filter(call => call.body?.operationId);
const edit = h => h.controller.editDefinition(d => { d.steps[0].payload.message = 'Nội dung mới'; return d; });

test('manage and editor show canonical active/candidate versions and escape Vietnamese content', async () => {
    const h = await fixture(); try {
        assert.match(h.doc.querySelector('.crm-auto-manage-list').textContent, /Active: v1 · Candidate: v2/);
        assert.equal(h.doc.querySelector('.crm-auto-manage-list b'), null);
        await h.open(); const summary = h.doc.querySelector('.crm-auto-version-summary').textContent;
        assert.match(summary, /Editing versionv2/); assert.match(summary, /Active versionv1/);
        edit(h); await h.controller.mutate('save');
        assert.equal(h.rule.currentVersion, 'v1'); assert.equal(h.rule.candidateVersion, 'v3');
        assert.equal(state(h).version.versionId, 'v3'); assert.equal(h.rule.enabled, true);
    } finally { h.close(); }
});

test('activation requires explicit confirmation and cannot submit twice', async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample(); await h.controller.generatePreview();
        const token = state(h).preview.previewToken;
        await h.click('activate'); assert.equal(writes(h).length, 0);
        assert.equal(h.doc.activeElement.dataset.autoAction, 'confirm-activate');
        const release = h.hold('/activate', 'POST');
        const confirm = button(h, 'confirm-activate'); confirm.click(); confirm.click(); await h.wait();
        assert.equal(writes(h).length, 1); assert.equal(writes(h)[0].body.previewToken, token);
        assert.equal(writes(h)[0].body.versionId, 'v2'); assert.equal(writes(h)[0].body.expectedRevision, 4);
        release(); await h.wait(); assert.equal(state(h).rule.currentVersion, 'v2'); assert.equal(state(h).pending, null);
    } finally { h.close(); }
});

for (const expiry of ['2000-01-01T00:00:00Z', 'not-a-date', null]) test(`expired/malformed preview ${expiry} cannot activate`, async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample(); h.expiresAt = expiry; await h.controller.generatePreview();
        assert.equal(button(h, 'activate').disabled, true);
        await h.controller.mutate('activate'); assert.equal(writes(h).length, 0);
    } finally { h.close(); }
});

test('expiry after confirmation opens and draft/context changes fence detached activation', async () => {
    for (const change of ['expiry', 'draft', 'schema', 'version']) {
        const h = await fixture(); try {
            await h.open(); await h.sample(); await h.controller.generatePreview(); await h.click('activate');
            if (change === 'expiry') { h.w.Date.now = () => Date.parse('3000-01-01'); }
            else if (change === 'draft') edit(h);
            else if (change === 'schema') h.controller.setContext(h.snapshot({ columns: [{ id: 'new', type: 'text' }] }));
            else await h.controller.openRule('r', { versionId: 'v1' });
            button(h, 'confirm-activate')?.click(); await h.controller.mutate('activate');
            assert.equal(writes(h).length, 0, change);
        } finally { h.close(); }
    }
});

test('uncertain activation retries the exact operation once and retains newer draft', async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample(); await h.controller.generatePreview();
        h.failures.push({ match: '/activate', status: 503, code: 'LOST_ACK', after: true });
        await h.click('activate'); await h.click('confirm-activate');
        const original = JSON.stringify(writes(h)[0].body); assert.ok(state(h).pending);
        edit(h); await h.controller.mutate('save'); await h.controller.mutate('duplicate');
        assert.equal(writes(h).length, 1); await h.controller.retryMutation();
        assert.equal(JSON.stringify(writes(h)[1].body), original); assert.equal(h.applied.length, 1);
        assert.equal(state(h).draft.definition.steps[0].payload.message, 'Nội dung mới'); assert.equal(state(h).dirty, true);
    } finally { h.close(); }
});

test('revision conflict retains draft and refresh never implicitly activates', async () => {
    const h = await fixture(); try {
        await h.open(); edit(h); h.rule.revision = 9; await h.controller.mutate('save');
        assert.equal(state(h).conflict, true, JSON.stringify(state(h))); assert.equal(state(h).dirty, true);
        assert.match(h.doc.querySelector('#projects-automations').textContent, /saved rule changed/);
        await h.controller.openRule('r', { preserveDraft: true });
        assert.equal(state(h).rule.revision, 9); assert.equal(state(h).draft.definition.steps[0].payload.message, 'Nội dung mới');
        await h.controller.mutate('save'); assert.equal(writes(h).at(-1).body.expectedRevision, 9);
        assert.equal(h.rule.currentVersion, 'v1');
    } finally { h.close(); }
});

test('manage/back/resume keeps title draft, definition, node identity and no writes', async () => {
    const h = await fixture(); try {
        await h.open(); h.controller.updateDraft({ title: 'Bản nháp chưa lưu' }); edit(h);
        const saved = JSON.stringify(state(h).draft); await h.click('manage');
        assert.equal(button(h, 'create').disabled, true); assert.equal(button(h, 'apply-recipe').disabled, true);
        h.controller.newDraft(); await h.controller.openRule('other'); assert.equal(JSON.stringify(state(h).draft), saved);
        await h.click('close'); assert.equal(h.doc.getElementById('projects-board-section').hidden, false);
        assert.equal(h.doc.activeElement.id, 'btn-projects-automate');
        await h.controller.show(); await h.click('resume'); assert.equal(JSON.stringify(state(h).draft), saved);
        assert.equal(h.doc.activeElement.id, 'auto-title'); assert.equal(writes(h).length, 0);
    } finally { h.close(); }
});

test('history selection is read-only; delayed run details cannot paint another history section', async () => {
    const h = await fixture(); try {
        await h.open(); edit(h); const saved = JSON.stringify(state(h).draft);
        await h.controller.loadHistory('versions'); await h.click('history-version');
        assert.equal(state(h).history.selected.versionId, 'v1'); assert.equal(state(h).version.versionId, 'v2');
        assert.equal(JSON.stringify(state(h).draft), saved); assert.ok(h.doc.querySelector('[data-auto-history-definition] fieldset').disabled);
        await h.controller.loadHistory('runs'); const release = h.hold('/automation-runs/'); const work = h.controller.showRun('run');
        assert.match(h.doc.querySelector('.crm-auto-history').textContent, /Loading run details/);
        await h.controller.loadHistory('versions'); release(); await work;
        assert.equal(state(h).history.run, undefined); assert.equal(JSON.stringify(state(h).draft), saved);
        await h.controller.loadHistory('runs'); await h.controller.showRun('run');
        assert.equal(state(h).history.run.versionId, 'v1'); assert.equal(state(h).version.versionId, 'v2');
    } finally { h.close(); }
});

for (const change of ['actor', 'project', 'access', 'schema']) test(`held preview rejects ${change} changes`, async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample(); const release = h.hold('/preview', 'POST'); const work = h.controller.generatePreview();
        if (change === 'actor') { h.actor = 'other'; h.controller.setAccount(h.actor); }
        else if (change === 'project') { h.controller.setSelection('q'); h.controller.setSelection('p'); h.controller.setContext(h.snapshot()); }
        else h.controller.setContext(h.snapshot(change === 'access' ? { membership: { role: 'Editor' } } : { columns: [{ id: 'other', type: 'text' }] }));
        release(); await work; assert.equal(state(h).preview, null); await h.controller.mutate('activate'); assert.equal(writes(h).length, 0);
    } finally { h.close(); }
});

test('Owner denial clears private draft and does not reenable from old authority', async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample(); await h.controller.generatePreview();
        h.failures.push({ match: '/activate', status: 403, code: 'PROJECT_OWNER_REQUIRED' });
        await h.click('activate'); await h.click('confirm-activate');
        assert.equal(state(h).draft, null); assert.equal(state(h).owner, false);
        h.controller.setContext(h.snapshot()); assert.equal(state(h).owner, false); assert.equal(h.applied.length, 0);
    } finally { h.close(); }
});

test('history loading/error/empty states and Escape focus are explicit', async () => {
    const h = await fixture(); try {
        await h.open(); const release = h.hold('/versions?'); const work = h.controller.loadHistory('versions');
        assert.match(h.doc.querySelector('.crm-auto-history').textContent, /Loading history/); release(); await work;
        h.failures.push({ match: '/versions?', status: 503, code: 'History offline' }); await h.controller.loadHistory('versions');
        assert.match(h.doc.querySelector('.crm-auto-history').textContent, /History is unavailable/);
        h.versions = []; await h.controller.loadHistory('versions'); assert.match(h.doc.querySelector('.crm-auto-history').textContent, /No history yet/);
        h.doc.querySelector('.crm-auto-history button').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(state(h).history.kind, ''); assert.equal(h.doc.activeElement.dataset.autoAction, 'versions');
    } finally { h.close(); }
});

test('held detail and preview cannot reopen or restore a preview after Back to project', async () => {
    const h = await fixture(); try {
        const release = h.hold('/automations/r'); const work = h.open();
        await h.click('close'); release(); await work;
        assert.equal(state(h).opened, false); assert.equal(state(h).rule, null);
        await h.controller.show(); await h.open(); await h.sample();
        const finish = h.hold('/preview', 'POST'); const preview = h.controller.generatePreview();
        await h.click('close'); finish(); await preview;
        assert.equal(state(h).opened, false); assert.equal(state(h).preview, null);
        assert.equal(state(h).version.versionId, 'v2');
    } finally { h.close(); }
});

test('held update preserves newer edits and actor/project changes reject acknowledgement', async () => {
    for (const change of ['draft', 'actor', 'project']) {
        const h = await fixture(); try {
            await h.open(); edit(h); const release = h.hold('/versions', 'POST'); const work = h.controller.mutate('save');
            if (change === 'draft') h.controller.editDefinition(d => { d.steps[0].payload.message = 'Newer definition'; return d; });
            else if (change === 'actor') { h.actor = 'other'; h.controller.setAccount(h.actor); }
            else h.controller.setSelection('other');
            release(); await work;
            if (change === 'draft') { assert.equal(state(h).draft.definition.steps[0].payload.message, 'Newer definition'); assert.equal(state(h).dirty, true); }
            else { assert.equal(state(h).draft, null); assert.equal(state(h).rule, null); }
        } finally { h.close(); }
    }
});

test('preview version mismatch cannot activate and pending operations cannot apply a template', async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample();
        const release = h.hold('/preview', 'POST'); const work = h.controller.generatePreview();
        await h.controller.openRule('r', { versionId: 'v1' }); release(); await work;
        assert.equal(state(h).preview, null); await h.controller.mutate('activate'); assert.equal(writes(h).length, 0);
        h.failures.push({ match: '/versions', status: 503, code: 'Offline' }); edit(h); await h.controller.mutate('save');
        const before = JSON.stringify(state(h).draft); await h.click('manage');
        const template = button(h, 'apply-recipe'); template.disabled = false; template.click();
        assert.equal(JSON.stringify(state(h).draft), before); assert.ok(state(h).pending);
    } finally { h.close(); }
});

for (const drift of ['actor', 'definition', 'both']) test(`refresh marks retained ${drift} divergence unsaved until deliberate save and confirmation`, async () => {
    const h = await fixture(); try {
        await h.open(); await h.sample(); await h.controller.generatePreview(); await h.click('activate');
        const staleConfirm = button(h, 'confirm-activate');
        h.controller.updateDraft({ title: 'Tên nháp giữ nguyên', folder: 'Thư mục nháp' });
        const retained = JSON.stringify(state(h).draft);
        const definition = JSON.parse(JSON.stringify(h.definition));
        if (drift !== 'actor') definition.steps[0].payload.message = 'Định nghĩa khác của chủ dự án';
        const next = h.publishCandidate({ actorUid: drift === 'definition' ? 'owner' : 'owner2', definition });
        await h.controller.openRule('r', { preserveDraft: true });
        assert.equal(JSON.stringify(state(h).draft), retained);
        assert.equal(state(h).version.versionId, next.versionId); assert.equal(state(h).dirty, true);
        assert.equal(h.doc.querySelector('#auto-actor').value, 'owner');
        assert.match(h.doc.querySelector('.crm-auto-version-summary').textContent, /Draft based on versionv3 · unsaved changes/);
        assert.equal(button(h, 'preview').disabled, true); assert.equal(button(h, 'activate').disabled, true);
        const previews = h.calls.filter(call => call.url.endsWith('/preview')).length;
        staleConfirm.click(); await h.controller.generatePreview(); await h.controller.mutate('activate');
        assert.equal(h.calls.filter(call => call.url.endsWith('/preview')).length, previews);
        assert.equal(writes(h).length, 0); assert.equal(state(h).preview, null);
        // Deliberately keep the retained actor/definition by saving it as a new immutable version.
        await h.controller.mutate('save');
        const saved = state(h).version;
        assert.equal(saved.versionId, 'v4'); assert.equal(saved.actorUid, 'owner');
        assert.equal(JSON.stringify(saved.definition), JSON.stringify(state(h).draft.definition));
        assert.equal(state(h).draft.title, 'Tên nháp giữ nguyên'); assert.equal(state(h).draft.folder, 'Thư mục nháp');
        assert.equal(state(h).dirty, false); assert.equal(h.rule.currentVersion, 'v1');
        await h.controller.generatePreview(); await h.click('activate');
        assert.equal(h.calls.filter(call => call.url.endsWith('/activate')).length, 0);
        await h.click('confirm-activate');
        const activation = h.calls.filter(call => call.url.endsWith('/activate'));
        assert.equal(activation.length, 1); assert.equal(activation[0].body.versionId, 'v4');
        assert.equal(activation[0].body.expectedRevision, 6); assert.equal(h.rule.activeActorUid, 'owner');
        assert.equal(h.rule.currentVersion, 'v4'); assert.equal(h.versions.find(v => v.versionId === 'v3').actorUid, next.actorUid);
    } finally { h.close(); }
});

test('refresh recomputes matching version as clean without discarding metadata draft', async () => {
    const h = await fixture(); try {
        await h.open(); edit(h); h.controller.updateDraft({ title: 'Tên nháp' });
        h.publishCandidate({ actorUid: state(h).draft.actorUid, definition: state(h).draft.definition });
        await h.controller.openRule('r', { preserveDraft: true });
        assert.equal(state(h).dirty, false); assert.equal(state(h).draft.title, 'Tên nháp');
        await h.click('manage'); assert.equal(button(h, 'create').disabled, true);
        assert.equal(writes(h).length, 0);
    } finally { h.close(); }
});

for (const order of ['page-first', 'run-first']) test(`same-feed pagination lets selected run finish (${order})`, async () => {
    const h = await fixture(); try {
        await h.open(); h.paginateRuns = true; await h.controller.loadHistory('runs');
        const releaseRun = h.hold('/automation-runs/'), run = h.controller.showRun('run');
        const releasePage = h.hold('cursor=runs-page-2'), page = h.controller.loadHistory('runs', true);
        assert.equal(state(h).history.runLoading, true); assert.equal(state(h).history.loading, true);
        if (order === 'page-first') { releasePage(); await page; assert.equal(state(h).history.runLoading, true); releaseRun(); await run; }
        else { releaseRun(); await run; assert.equal(state(h).history.runLoading, false); releasePage(); await page; }
        const history = state(h).history;
        assert.equal(history.loading, false); assert.equal(history.runLoading, false);
        assert.deepEqual(Array.from(history.items, item => item.runId), ['run', 'run-next']);
        assert.equal(history.cursor, null); assert.equal(history.run.run.runId, 'run'); assert.equal(history.run.versionId, 'v1');
        assert.equal(state(h).version.versionId, 'v2');
        assert.ok(h.calls.some(call => call.url.endsWith('/automations/r?versionId=v1')));
        assert.doesNotMatch(h.doc.querySelector('.crm-auto-history').textContent, /Loading run details/);
    } finally { h.close(); }
});

for (const destination of ['versions', 'close-history', 'close']) test(`pending paginated run is fenced after ${destination}`, async () => {
    const h = await fixture(); try {
        await h.open(); h.paginateRuns = true; await h.controller.loadHistory('runs');
        const releaseRun = h.hold('/automation-runs/'), run = h.controller.showRun('run');
        const releasePage = h.hold('cursor=runs-page-2'), page = h.controller.loadHistory('runs', true);
        if (destination === 'versions') await h.controller.loadHistory('versions'); else await h.click(destination);
        releasePage(); releaseRun(); await Promise.all([page, run]);
        assert.equal(state(h).history.kind, destination === 'versions' ? 'versions' : '');
        assert.equal(state(h).history.run, undefined); assert.ok(!state(h).history.loading); assert.ok(!state(h).history.runLoading);
        assert.equal(h.calls.some(call => call.url.endsWith('/automations/r?versionId=v1')), false);
        assert.equal(state(h).version.versionId, 'v2'); assert.equal(writes(h).length, 0);
    } finally { h.close(); }
});
