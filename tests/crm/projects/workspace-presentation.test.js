'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'public/js/crm/projects/workspace.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8');

// Event/observer adapter, not a browser geometry or native focus-trap substitute.
function fixture() {
    const pendingObservers = new Set(), observers = [], timers = new Map();
    let timerId = 0, uid = 'actor-a';
    const selected = [], managed = [], nodes = new Map();
    const document = { activeElement: null, getElementById: id => nodes.get(id) || null };
    class Element {
        constructor(tag = 'div', attrs = {}) {
            this.tagName = tag; this.attrs = {}; this.dataset = {}; this.children = []; this.listeners = new Map();
            this.open = false; this.disabled = false; this.textContent = ''; this.clicks = 0; this.modalCalls = 0; this.closeCalls = 0;
            const classes = new Set();
            this.classList = { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key), toggle: (key, force) => { const on = force === undefined ? !classes.has(key) : force; if (on) classes.add(key); else classes.delete(key); return on; } };
            Object.entries(attrs).forEach(([key, value]) => this.setAttribute(key, value));
        }
        setAttribute(key, value) {
            const previous = this.attrs[key]; this.attrs[key] = String(value);
            if (key === 'id') { this.id = String(value); nodes.set(this.id, this); }
            if (key === 'name') this.name = String(value);
            if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
            if (previous !== this.attrs[key]) this.notify(key);
        }
        getAttribute(key) { return this.attrs[key] ?? null; }
        notify(key) { for (const observer of observers) if (observer.target === this && observer.options.attributeFilter.includes(key)) pendingObservers.add(observer); }
        get hidden() { return Object.hasOwn(this.attrs, 'hidden'); }
        set hidden(value) { if (value) this.setAttribute('hidden', ''); else if (this.hidden) { delete this.attrs.hidden; this.notify('hidden'); } }
        append(child) { child.parent = this; this.children.push(child); return child; }
        contains(node) { return this === node || this.children.some(child => child.contains(node)); }
        matches(selector) {
            const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
            return attr ? Object.hasOwn(this.attrs, attr[1]) && (attr[2] === undefined || this.attrs[attr[1]] === attr[2]) : this.tagName === selector;
        }
        closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
        querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(handler); }
        removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler); }
        dispatch(name, extra = {}, bubbles = true) {
            const event = { type: name, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
            let node = this;
            do { for (const handler of [...(node.listeners.get(name) || [])]) handler(event); node = bubbles ? node.parent : null; } while (node);
            return event;
        }
        click() { if (!this.disabled) { this.clicks++; if (this.clicks > 20) throw Error('Recursive cancel click'); this.dispatch('click'); } }
        focus() { document.activeElement = this; }
        showModal() { assert.equal(this.open, false, 'must not show an already-open dialog'); this.modalCalls++; this.open = true; }
        close() { this.closeCalls++; this.open = false; this.dispatch('close', {}, false); }
        requestSubmit() { this.submits = (this.submits || 0) + 1; this.dispatch('submit'); }
        set innerHTML(value) {
            this.markup = value; this.children = [];
            for (const match of value.matchAll(/<button\b([^>]*)>/g)) {
                const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
                this.append(new Element('button', attrs));
            }
        }
    }
    const panel = new Element('section', { 'data-panel': 'projects' });
    document.querySelector = selector => panel.matches(selector) ? panel : null;
    function add(id, tag = 'div', parent = panel, attrs = {}) {
        assert.ok(html.includes(`id="${id}"`), `fixture ID must exist in actual shell: ${id}`);
        return parent.append(new Element(tag, { id, ...attrs }));
    }
    const rail = add('projects-workspace-rail'), projectNav = add('projects-workspace-projects', 'nav', rail);
    const toggle = add('projects-workspace-rail-toggle', 'button');
    for (const id of ['projects-workspace-name', 'projects-workspace-description', 'projects-workspace-onboarding', 'projects-workspace-onboarding-title', 'projects-workspace-onboarding-message']) add(id);
    for (const id of ['projects-workspace-manage-access', 'btn-projects-board-create-project', 'btn-projects-board-empty-create']) add(id, 'button');
    const settings = add('projects-workspace-settings', 'dialog', panel, { 'data-projects-dialog': '', hidden: '' });
    const tabs = ['project', 'members', 'calendar', 'allowance'].map(name => settings.append(new Element('button', { 'data-projects-settings-tab': name })));
    const sections = tabs.map(tab => settings.append(new Element('section', { 'data-projects-settings-panel': tab.dataset.projectsSettingsTab })));
    const settingsClose = settings.append(new Element('button', { 'data-projects-close': '' }));
    const opener = panel.append(new Element('button', { 'data-projects-open': settings.id }));
    const detail = add('projects-board-detail', 'dialog', panel, { 'data-projects-dialog': '', hidden: '' });
    const detailCancel = add('btn-projects-board-close-detail', 'button', detail, { 'data-projects-close': '' });
    const create = add('projects-board-create-project', 'dialog', panel, { 'data-projects-dialog': '', hidden: '' });
    const createCancel = add('btn-projects-board-cancel-project', 'button', create, { 'data-projects-close': '' });
    const filters = add('projects-view-filters', 'form');
    const title = filters.append(new Element('input', { name: 'title' }));
    const status = filters.append(new Element('select', { name: 'status' }));
    const filterDetails = filters.append(new Element('details'));
    const utility = panel.append(new Element('details'));
    const utilityRail = add('projects-utility-rail', 'aside');
    const utilityTab = add('projects-utab-recovery', 'button', utilityRail, { 'data-u': 'recovery' });
    const utilityWorkspace = add('projects-utility-workspace', 'dialog', utilityRail, { 'data-projects-dialog': '', hidden: '' });
    const recovery = add('projects-board-recovery', 'section', utility, { hidden: '' });
    const automations = add('projects-automations', 'section', utility, { hidden: '' });
    const notifications = add('projects-notifications', 'section', utility, { hidden: '' });
    class MutationObserver {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; }
        disconnect() { this.target = null; pendingObservers.delete(this); }
    }
    const scope = { document, MutationObserver, setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } };
    vm.runInNewContext(source, scope, { filename: 'workspace.js' });
    const controller = scope.CrmProjectsWorkspace.createController({ document, getCurrentUser: () => ({ uid }), selectProject: id => selected.push(id), onManageAccess: () => managed.push(uid) });
    controller.init();
    function flush() { let iterations = 0; while (pendingObservers.size) { assert.ok(++iterations < 30, 'observer loop must settle'); const batch = [...pendingObservers]; pendingObservers.clear(); batch.forEach(observer => { if (observer.target) observer.callback(); }); } }
    function tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); flush(); }
    const summary = (grant, admin = false) => ({ identity: { uid, moduleGrants: { projects: grant } }, canManagePeople: admin });
    return { controller, nodes, panel, rail, projectNav, toggle, settings, settingsClose, opener, tabs, sections, detail, detailCancel, create, createCancel, filters, title, status, filterDetails, utility, utilityRail, utilityTab, utilityWorkspace, recovery, automations, notifications, selected, managed, document, timers, observers, flush, tick, summary, Element, setActor(value) { uid = value; } };
}

test('access onboarding distinguishes module grant, actionable admin access and another actor summary', () => {
    const f = fixture();
    f.controller.setSelection({ projects: [], accessSummary: f.summary(false, true) });
    assert.equal(f.nodes.get('projects-workspace-onboarding').hidden, false);
    assert.equal(f.nodes.get('btn-projects-board-create-project').hidden, true);
    f.nodes.get('projects-workspace-manage-access').click(); assert.deepEqual(f.managed, ['actor-a']);
    f.controller.setSelection({ projects: [], accessSummary: f.summary(false) });
    assert.equal(f.nodes.get('projects-workspace-manage-access').hidden, true);
    assert.match(f.nodes.get('projects-workspace-onboarding-message').textContent, /Ask an administrator/);
    f.controller.setSelection({ projects: [], accessSummary: { identity: { uid: 'other', moduleGrants: { projects: false } } } });
    assert.equal(f.nodes.get('projects-workspace-onboarding').hidden, true);
    f.controller.setSelection({ projects: [], accessSummary: f.summary(true) });
    assert.equal(f.panel.classList.contains('crm-projects-access-needed'), false);
});

test('rail selection uses listed IDs, keeps mismatched context out, escapes labels and fences changed actor', () => {
    const f = fixture();
    f.controller.setSelection({ projects: [{ id: 'p-one', name: '<img src=x>' }, { id: 'p-two', name: 'Second' }], selectedProjectId: 'p-one', accessSummary: f.summary(true) });
    assert.match(f.projectNav.markup, /&lt;img src=x&gt;/);
    f.controller.setContext({ project: { id: 'foreign', name: 'Wrong project', description: 'Wrong context' } });
    assert.equal(f.nodes.get('projects-workspace-name').textContent, '<img src=x>');
    f.controller.setContext({ project: { id: 'p-one', description: 'Loaded context without a name' } });
    assert.equal(f.nodes.get('projects-workspace-name').textContent, '<img src=x>', 'selected rail name survives partial loaded context');
    f.controller.setContext({ project: { id: 'p-one', name: 'Current project', description: 'Saved description' } });
    assert.equal(f.nodes.get('projects-workspace-description').textContent, 'Saved description');
    f.toggle.click(); assert.equal(f.rail.classList.contains('is-open'), true);
    f.projectNav.children[1].click(); assert.deepEqual(f.selected, ['p-two']);
    assert.equal(f.rail.classList.contains('is-open'), false); assert.equal(f.toggle.getAttribute('aria-expanded'), 'false');
    f.projectNav.append(new f.Element('button', { 'data-workspace-project': 'not-listed' })).click(); assert.equal(f.selected.length, 1);
    f.setActor('actor-b'); f.projectNav.children[0].click(); f.toggle.click();
    f.controller.setSelection({ projects: [{ id: 'p-new', name: 'New actor data' }], selectedProjectId: 'p-new' });
    assert.deepEqual(f.selected, ['p-two']); assert.equal(f.rail.classList.contains('is-open'), false);
    assert.equal(f.nodes.get('projects-workspace-name').textContent, 'Current project');
});

test('hidden changes synchronize dialogs; direct Close and Escape delegate exactly once without recursion', () => {
    const f = fixture();
    let controllerCloses = 0; f.detailCancel.addEventListener('click', () => { controllerCloses++; f.detail.hidden = true; });
    f.detail.hidden = false; f.flush(); assert.equal(f.detail.open, true); assert.equal(f.detail.modalCalls, 1);
    f.detailCancel.click(); f.flush(); assert.equal(controllerCloses, 1); assert.equal(f.detailCancel.clicks, 1); assert.equal(f.detail.open, false);
    f.detail.hidden = false; f.flush();
    const cancel = f.detail.dispatch('cancel', {}, false); f.flush();
    assert.equal(cancel.defaultPrevented, true); assert.equal(controllerCloses, 2); assert.equal(f.detailCancel.clicks, 2); assert.equal(f.detail.open, false);
    f.opener.click(); f.flush(); assert.equal(f.settings.open, true);
    f.settingsClose.click(); f.flush(); assert.equal(f.settings.open, false); assert.equal(f.settingsClose.clicks, 1);
});

test('pending cancel remains disabled and a stale actor cannot reopen a dialog', () => {
    const f = fixture(); f.create.hidden = false; f.flush(); f.createCancel.disabled = true;
    f.create.dispatch('cancel', {}, false); f.flush(); assert.equal(f.create.open, true); assert.equal(f.createCancel.clicks, 0);
    f.createCancel.disabled = false; f.create.dispatch('cancel', {}, false); f.flush(); assert.equal(f.create.open, false); assert.equal(f.createCancel.clicks, 1);
    f.setActor('actor-b'); f.create.hidden = false; f.flush(); assert.equal(f.create.open, false); assert.equal(f.create.hidden, true);
    f.opener.click(); assert.equal(f.settings.open, false);
});

test('navigation closes the task through its controller once and remains usable on return', () => {
    const f = fixture();
    let detailCleanup = 0;
    f.detailCancel.addEventListener('click', () => { detailCleanup++; f.detail.hidden = true; });
    f.controller.setSelection({ projects: [{ id: 'p-one', name: 'Project one' }], selectedProjectId: 'p-one', accessSummary: f.summary(true) });
    f.detail.hidden = false; f.flush(); assert.equal(f.detail.open, true);
    f.controller.closeForNavigation(); f.flush();
    assert.equal(detailCleanup, 1); assert.equal(f.detailCancel.clicks, 1);
    assert.equal(f.detail.open, false); assert.equal(f.detail.hidden, true);
    f.controller.closeForNavigation(); f.flush(); assert.equal(detailCleanup, 1, 'repeated route rendering must not repeat cleanup');
    // Returning to Projects reuses, rather than disposes, the same controller.
    f.controller.setContext({ project: { id: 'p-one', name: 'Back on the board' } });
    assert.equal(f.nodes.get('projects-workspace-name').textContent, 'Back on the board');
    f.projectNav.children[0].click(); assert.deepEqual(f.selected, ['p-one']);
    f.detail.hidden = false; f.flush(); assert.equal(f.detail.open, true);
    f.controller.closeForNavigation(); f.flush(); assert.equal(detailCleanup, 2);
    f.setActor('actor-b');
    f.controller.setSelection({ projects: [{ id: 'p-two', name: 'Stale selection' }], selectedProjectId: 'p-two' });
    f.controller.setContext({ project: { id: 'p-two', name: 'Stale context' } });
    assert.equal(f.detail.open, false); assert.equal(f.settings.open, false);
    assert.equal(f.nodes.get('projects-workspace-name').textContent, 'Back on the board');
    f.detail.hidden = false; f.flush(); assert.equal(f.detail.open, false); assert.equal(f.detail.hidden, true);
    f.opener.click(); assert.equal(f.settings.open, false);
});

test('settings keyboard wraps, uses Home/End and exposes only the selected panel', () => {
    const f = fixture(); f.opener.click();
    assert.deepEqual(f.sections.map(section => section.hidden), [false, true, true, true]);
    const right = f.tabs[0].dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(right.defaultPrevented, true); assert.equal(f.document.activeElement, f.tabs[1]);
    assert.deepEqual(f.tabs.map(tab => tab.tabIndex), [-1, 0, -1, -1]);
    assert.deepEqual(f.sections.map(section => section.hidden), [true, false, true, true]);
    f.tabs[1].dispatch('keydown', { key: 'End' }); assert.equal(f.document.activeElement, f.tabs[3]);
    f.tabs[3].dispatch('keydown', { key: 'ArrowRight' }); assert.equal(f.document.activeElement, f.tabs[0]);
    f.tabs[0].dispatch('keydown', { key: 'ArrowLeft' }); assert.equal(f.document.activeElement, f.tabs[3]);
    f.tabs[3].dispatch('keydown', { key: 'Home' }); assert.equal(f.document.activeElement, f.tabs[0]);
    f.tabs[2].click(); assert.equal(f.tabs[2].getAttribute('aria-selected'), 'true');
});

test('title search delegates a debounced submit, respects reset/actor/disabled state and disposal', () => {
    const f = fixture(); f.controller.init(); f.filterDetails.open = true;
    f.status.dispatch('input'); f.tick(); assert.equal(f.filters.submits || 0, 0);
    f.title.dispatch('input'); f.title.dispatch('input'); assert.equal(f.timers.size, 1); f.tick();
    assert.equal(f.filters.submits, 1); assert.equal(f.filterDetails.open, false);
    f.title.dispatch('input'); f.filters.dispatch('reset'); f.tick(); assert.equal(f.filters.submits, 1);
    f.title.dispatch('input'); f.title.disabled = true; f.tick(); assert.equal(f.filters.submits, 1);
    f.title.disabled = false; f.title.dispatch('input'); f.setActor('actor-b'); f.tick(); assert.equal(f.filters.submits, 1);
    f.setActor('actor-a'); f.opener.click(); f.title.dispatch('input'); f.controller.dispose(); f.tick();
    assert.equal(f.filters.submits, 1); assert.equal(f.settings.open, false); assert.equal(f.settings.hidden, true);
    assert.ok(f.observers.every(observer => observer.target === null));
    f.title.dispatch('input'); f.toggle.click(); assert.equal(f.timers.size, 0); assert.equal(f.rail.classList.contains('is-open'), false);
});

test('recovery and notification startup stay collapsed; explicit automation reveals the utility', () => {
    const f = fixture(); f.notifications.hidden = false; f.flush(); assert.equal(f.utility.open, false);
    f.recovery.hidden = false; f.flush(); assert.equal(f.utility.open, false, 'recovery visibility on board load must not open the utility');
    f.utility.open = false; f.automations.hidden = false; f.flush(); assert.equal(f.utility.open, true);
});

test('utility tab selection opens the workspace dialog before activating its pane', () => {
    const f = fixture();
    f.utilityTab.click(); f.flush();
    assert.equal(f.utilityWorkspace.hidden, false);
    assert.equal(f.utilityWorkspace.open, true);
    assert.equal(f.utilityWorkspace.modalCalls, 1);
    assert.equal(f.utilityTab.getAttribute('aria-selected'), 'true');
});
