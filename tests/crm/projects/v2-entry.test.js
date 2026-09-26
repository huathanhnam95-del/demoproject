'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const { createFixture } = require('../../fixtures/crm/projects-v2');
test('scale fixtures retain identity, roles, statuses, deep and unloaded branches, unavailable values', () => {
    for (const size of [30, 500, 5000]) {
        const fixture = createFixture(size);
        assert.equal(fixture.tasks.length, size); assert.equal(new Set(fixture.tasks.map(t => t.id)).size, size);
        assert.equal(fixture.projects.length, 2); assert.equal(fixture.people.length, 4);
        assert.equal(new Set(fixture.tasks.map(t => t.status)).size, 4);
        assert.equal(fixture.tasks[3].ancestorIds.length, 3);
        assert.equal(fixture.tasks[0].values['c-dropdown'], 'removed-option');
        assert.equal(fixture.columns.length, 7); assert.equal(fixture.tasks[5].lifecycle, 'archived');
        assert.equal(fixture.columns.find(c => c.type === 'dropdown').options[0].key, fixture.tasks[1].values['c-dropdown']);
        if (size > 100) assert.ok(fixture.tasks[4].childCount > 0);
    }
});
function modules() {
    const context = {};
    for (const name of ['field-feedback', 'entry']) {
        const filename = path.join(root, `public/js/crm/projects/presentation/${name}.js`);
        if (fs.existsSync(filename)) vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
    }
    return context;
}
test('V2 composition selects exactly one workspace and disposes its scoped root', () => {
    const api = modules().CrmProjectsPresentationV2;
    assert.ok(api, 'V2 entry must be registered');
    for (const enabled of [undefined, false, 'true', true]) {
        let created = 0, initialized = 0, disposed = 0;
        const classes = new Set();
        const panel = { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } };
        const legacy = { init: () => initialized++, dispose: () => disposed++, setContext() {}, setSelection() {} };
        const controller = api.createController({ config: { projectsV2: enabled }, panel, createWorkspace: () => { created++; return legacy; } });
        controller.init(); assert.equal(created, 1); assert.equal(initialized, 1);
        assert.equal(classes.has('projects-v2'), enabled === true);
        if (enabled !== true) assert.equal(controller, legacy);
        controller.dispose(); assert.equal(disposed, 1); assert.equal(classes.size, 0);
    }
});
test('feedback rejects old scope, older edits and late phase regressions; reset/dispose clear metadata', () => {
    const api = modules().CrmProjectsFieldFeedbackV2; assert.ok(api, 'feedback projection must be registered');
    const scope = { actorUid: 'a', projectId: 'p', epoch: 1 }, feedback = api.createStore(scope);
    const event = (editVersion, phase, extra = {}) => ({ scope, taskId: 't', field: 'title', editVersion, phase, ...extra });
    feedback.accept(event(1, 'saving', { operationId: 'one' }));
    feedback.accept(event(2, 'dirty')); feedback.accept(event(1, 'saved'));
    assert.equal(feedback.get('t', 'title').phase, 'dirty');
    feedback.accept(event(2, 'saving', { operationId: 'two' }));
    feedback.accept(event(2, 'saved', { operationId: 'wrong' }));
    assert.equal(feedback.get('t', 'title').phase, 'saving');
    feedback.accept(event(2, 'saved', { operationId: 'two' })); feedback.accept(event(2, 'dirty'));
    assert.equal(feedback.get('t', 'title').phase, 'saved');
    feedback.setScope({ ...scope, epoch: 2 }); assert.equal(feedback.get('t', 'title'), null);
    assert.equal(feedback.accept(event(3, 'saving')), false);
    feedback.dispose(); assert.equal(feedback.accept({ ...event(3, 'dirty'), scope: { ...scope, epoch: 2 } }), false);
});
test('actual CRM composition wires one workspace, scope and flag with ordered scripts', () => {
    const shell = fs.readFileSync(path.join(root, 'public/crm-admin.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8');
    const start = shell.indexOf('    projectsWorkspaceController?.dispose?.();');
    const end = shell.indexOf('    // Controller scopes are document-local.', start);
    assert.ok(start > 0 && end > start);
    const loader = fs.readFileSync(path.join(root, 'public/js/crm/projects/loader.js'), 'utf8');
    const scriptNames = ['projects/workspace.js', 'projects/presentation/field-feedback.js', 'projects/presentation/ui-preferences.js', 'projects/presentation/shell.js', 'projects/presentation/entry.js'];
    const positions = scriptNames.map(name => loader.indexOf(name));
    assert.ok(html.indexOf('projects/loader.js') < html.indexOf('src="crm-admin.js'));
    assert.match(html, /src="js\/crm\/projects\/access.js/);
    assert.doesNotMatch(html, /src="js\/crm\/projects\/(?:board|views|workspace|date-picker).js/);
    assert.ok(positions.every((position, index) => position > 0 && (!index || position > positions[index - 1])));
    assert.match(html, /__CRM_PRESENTATION_CONFIG__ = Object.freeze\(\{ projectsV2: projectsV2Query !== '0' \}\)/);
    assert.match(shell, /onFieldSaveEvent: event => projectsWorkspaceController\?\.onFieldSaveEvent\?\.\(event\)/);
    assert.match(shell, /onFieldSaveScopeChanged: scope => projectsWorkspaceController\?\.setFieldSaveScope\?\.\(scope\)/);
    for (const enabled of [false, true]) {
        const context = modules(), counts = { created: 0, init: 0, disposed: 0 };
        const panel = { classList: { add() {}, remove() {} } };
        context.window = context;
        context.__CRM_PRESENTATION_CONFIG__ = { projectsV2: enabled };
        context.document = { querySelector: () => panel };
        context.user = { uid: 'actor' };
        context.projectsWorkspaceController = { dispose: () => counts.disposed++ };
        context.projectsAccessController = { getSelection: () => ({ selectedProjectId: 'a' }) };
        context.projectsBoardController = { getFieldSaveScope: () => ({ actorUid: 'actor', projectId: 'a', epoch: 1 }), getState: () => ({}) };
        context.CrmProjectsWorkspace = { createController: () => { counts.created++; return { init: () => counts.init++, setContext() {}, setSelection() {} }; } };
        vm.runInNewContext(shell.slice(start, end), context);
        assert.deepEqual(counts, { created: 1, init: 1, disposed: 1 });
        if (enabled) assert.equal(context.projectsWorkspaceController.onFieldSaveEvent({ scope: { actorUid: 'actor', projectId: 'a', epoch: 1 }, taskId: 't', field: 'title', phase: 'dirty', editVersion: 1 }), true);
    }
});

test('actual inline presentation flag defaults every host to V2 with explicit legacy rollback', () => {
    const html = fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('window.__CRM_PRESENTATION_CONFIG__'));
    assert.ok(inline);
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'example.com', 'localhost.example.com', '127.0.0.2', '::1']) {
        for (const [search, enabled] of [
            ['', true], ['?other=x', true], ['?projectsV2=0', false],
            ['?projectsV2=true', true], ['?projectsV2=', true],
            ['?projectsV2=1', true], ['?other=x&projectsV2=1', true],
            ['?other=x&projectsV2=0', false],
            ['?projectsV2=0&projectsV2=1', false],
            ['?projectsV2=1&projectsV2=0', true]
        ]) {
            const context = { window: {}, location: { hostname, search }, URLSearchParams };
            vm.runInNewContext(inline, context);
            assert.equal(context.window.__CRM_PRESENTATION_CONFIG__.projectsV2, enabled, `${hostname}${search}`);
            assert.ok(Object.isFrozen(context.window.__CRM_PRESENTATION_CONFIG__));
        }
    }
});

function loaderFixture() {
    const source = fs.readFileSync(path.join(root, 'public/js/crm/projects/loader.js'), 'utf8');
    const entries = JSON.parse(source.match(/const scripts = (\[[\s\S]*?\]);/)[1]);
    const appended = [], events = new Map();
    const context = { URL, setTimeout, clearTimeout, document: { baseURI: 'http://localhost/crm-admin.html',
        createElement: tag => ({ tag, remove() { this.removed = true; } }),
        head: { appendChild: node => appended.push(node) }
    }, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
    vm.runInNewContext(source, context);
    const script = () => appended.filter(node => node.tag === 'script').at(-1);
    async function succeedRest() {
        for (let index = 0; index < entries.length; index++) {
            const current = script();
            if (current?.onload) {
                const entry = entries.find(([src]) => src === current.src);
                context[entry[1]] = {};
                current.onload();
            }
            await new Promise(resolve => setImmediate(resolve));
        }
    }
    return { context, entries, appended, events, script, succeedRest, api: context.CrmProjectsLoader };
}
test('loader preload downloads only; concurrent loads share work and warm loads do not execute again', async () => {
    const f = loaderFixture();
    f.api.preload(); f.api.preload();
    assert.equal(f.appended.length, f.entries.length);
    assert.ok(f.appended.every(node => node.tag === 'link' && node.as === 'script'));
    const first = f.api.ensure();
    assert.equal(f.api.ensure(), first);
    assert.equal(f.appended.filter(node => node.tag === 'script').length, 1);
    await f.succeedRest(); await first;
    assert.deepEqual(f.appended.filter(node => node.tag === 'script').map(node => node.src), f.entries.map(entry => entry[0]));
    const count = f.appended.length;
    await f.api.ensure(); assert.equal(f.appended.length, count);
});
test('loader retries the failed download without executing successful modules again', async () => {
    const f = loaderFixture(), first = f.api.ensure();
    f.context[f.entries[0][1]] = {}; f.script().onload();
    await new Promise(resolve => setImmediate(resolve));
    const failed = f.script(); failed.onerror();
    await assert.rejects(first, /Could not load/);
    assert.equal(failed.removed, true);
    const retry = f.api.ensure();
    assert.equal(f.script().src, f.entries[1][0]);
    await f.succeedRest(); await retry;
    assert.equal(f.appended.filter(node => node.tag === 'script' && node.src === f.entries[0][0]).length, 1);
});
test('loader rejects missing globals and script evaluation errors before later modules run', async () => {
    for (const evaluationError of [false, true]) {
        const f = loaderFixture(), pending = f.api.ensure();
        if (evaluationError) {
            f.context[f.entries[0][1]] = {};
            f.events.get('error')({ filename: new URL(f.entries[0][0], f.context.document.baseURI).href, error: new Error('evaluation failed') });
        }
        f.script().onload();
        await assert.rejects(pending, evaluationError ? /evaluation failed/ : /did not register/);
        assert.equal(f.appended.filter(node => node.tag === 'script').length, 1);
        await assert.rejects(f.api.ensure(), error => error.reloadRequired === true);
    }
});

test('hung script offers a document restart and cannot be executed twice by retry', async () => {
    const f = loaderFixture();
    let expire;
    f.context.setTimeout = fn => { expire = fn; return 1; };
    f.context.clearTimeout = () => {};
    const first = f.api.ensure();
    const script = f.script();
    expire();
    await assert.rejects(first, error => error.reloadRequired === true);
    assert.equal(script.onload, null);
    await assert.rejects(f.api.ensure(), error => error.reloadRequired === true);
    assert.equal(f.appended.filter(node => node.tag === 'script').length, 1);
});
