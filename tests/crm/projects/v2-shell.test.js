'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
function fixture(storage) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://fixture.invalid' });
    for (const name of ['workspace', 'presentation/field-feedback', 'presentation/ui-preferences', 'presentation/shell', 'presentation/entry']) {
        const p = path.join(root, `public/js/crm/projects/${name}.js`);
        if (fs.existsSync(p)) dom.window.eval(fs.readFileSync(p, 'utf8'));
    }
    let uid = 'actor'; const document = dom.window.document, panel = document.querySelector('[data-panel="projects"]');
    const context = { dom, document, panel, win: dom.window, setActor: value => { uid = value; }, getCurrentUser: () => ({ uid }), storage };
    return context;
}
function memory(initial = {}) { const data = new Map(Object.entries(initial)); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }
test('V2 migrates explicit scale per actor, preserves the legacy key, validates persisted preferences', () => {
    for (const legacy of [null, '125', '150', '70', 'not-valid']) {
        const storage = memory(legacy === null ? {} : { 'crm:projects:ui-scale': legacy }), h = fixture(storage);
        const api = h.win.CrmProjectsPreferencesV2; assert.ok(api, 'preferences controller exists');
        const calls = [], prefs = api.createController({ ...h, onDensity: (mode, scale) => calls.push([mode, scale]) });
        prefs.init();
        const expected = ['125', '150', '70'].includes(legacy) ? Number(legacy) : 100;
        assert.equal(prefs.getState().textPercent, expected);
        assert.equal(storage.getItem('crm:projects:ui-scale'), legacy);
        assert.equal(h.panel.style.getPropertyValue('--pj-v2-text-scale'), String(expected / 100));
        assert.deepEqual(calls[0], ['comfortable', expected / 100]);
        prefs.setDensity('compact'); prefs.dispose();
        const again = api.createController({ ...h, onDensity() {} }); again.init(); assert.equal(again.getState().density, 'compact'); again.dispose();
        h.setActor('other'); const other = api.createController({ ...h, onDensity() {} }); other.init(); assert.equal(other.getState().density, 'comfortable'); other.dispose();
        h.dom.window.close();
    }
});
test('throwing storage getter and malformed records fall back to usable in-memory preferences', () => {
    const h = fixture(); assert.ok(h.win.CrmProjectsPreferencesV2);
    Object.defineProperty(h.win, 'localStorage', { get() { throw new Error('storage denied'); } });
    const prefs = h.win.CrmProjectsPreferencesV2.createController({ ...h }); prefs.init();
    const input = h.document.getElementById('projects-ui-scale'); input.value = '150'; input.dispatchEvent(new h.win.Event('input'));
    assert.equal(prefs.getState().textPercent, 150); prefs.dispose(); h.dom.window.close();
});
test('switching V2 off restores legacy inline scale, density and control state without rewriting legacy storage', () => {
    const h = fixture(memory({ 'crm:projects:ui-scale': '150' }));
    h.panel.style.setProperty('--crm-projects-ui-scale', '1.5');
    const table = h.document.getElementById('projects-board-table-wrap');
    const calls = [], prefs = h.win.CrmProjectsPreferencesV2.createController({ ...h, onDensity: (mode, scale) => { calls.push([mode, scale]); table.style.setProperty('--pj-row-h', '66px'); } });
    prefs.init(); assert.equal(h.panel.style.getPropertyValue('--crm-projects-ui-scale'), '1');
    prefs.dispose();
    assert.equal(h.panel.style.getPropertyValue('--crm-projects-ui-scale'), '1.5');
    assert.equal(table.style.getPropertyValue('--pj-row-h'), '');
    assert.equal(calls.at(-1)[1], undefined);
    assert.equal(h.document.querySelector('label[for="projects-ui-scale"]').textContent, 'Interface size');
    h.dom.window.close();
});
test('corrupt versioned records are sanitized and stale actors cannot persist another preference', () => {
    for (const raw of ['{broken', '[]', '{"schemaVersion":2,"textPercent":150,"density":"compact"}', '{"schemaVersion":1,"textPercent":999,"density":"compact"}']) {
        const key = 'crm:projects:v2:prefs:1:actor', storage = memory({ [key]: raw });
        const h = fixture(storage), prefs = h.win.CrmProjectsPreferencesV2.createController({ ...h }); prefs.init();
        assert.equal(prefs.getState().textPercent, 100); assert.equal(prefs.getState().density, 'comfortable');
        const prior = storage.getItem(key); h.setActor('other'); prefs.setDensity('compact'); assert.equal(storage.getItem(key), prior);
        prefs.dispose(); h.dom.window.close();
    }
});
test('shell relocates original panes once, keeps drafts/listeners, restores on disposal and closes on scope changes', () => {
    const h = fixture(memory()); const api = h.win.CrmProjectsShellV2; assert.ok(api, 'shell controller exists');
    const pane = h.document.getElementById('projects-upane-assistant'), originalParent = pane.parentNode;
    const host = h.document.getElementById('projects-assistant'); host.innerHTML = '<textarea>Retained draft</textarea><button>Probe</button>';
    let clicks = 0, automationOpens = 0; host.querySelector('button').addEventListener('click', () => clicks++);
    const shell = api.createController({ ...h, openAutomations: () => automationOpens++ }); shell.init(); shell.init();
    shell.setSelection({ selectedProjectId: 'a' });
    h.document.getElementById('projects-utab-assistant').click();
    assert.equal(h.document.getElementById('projects-utility-page').hidden, false);
    assert.equal(h.document.getElementById('projects-board-section').hidden, true);
    assert.equal(h.document.getElementById('projects-upane-assistant'), pane);
    host.querySelector('button').click(); assert.equal(clicks, 1);
    assert.equal(host.querySelector('textarea').value, 'Retained draft');
    h.document.getElementById('projects-utab-automations').click(); assert.equal(automationOpens, 1);
    shell.setSelection({ selectedProjectId: 'b' }); assert.equal(h.document.getElementById('projects-utility-page').hidden, true);
    const ids = [...h.panel.querySelectorAll('[id]')].map(n => n.id); assert.equal(new Set(ids).size, ids.length);
    shell.dispose(); shell.dispose(); assert.equal(pane.parentNode, originalParent);
    assert.equal(h.document.getElementById('projects-utility-page'), null);
    h.document.getElementById('projects-utab-automations').click(); assert.equal(automationOpens, 1);
    h.dom.window.close();
});
test('V2 workspace skips obsolete rail observer/listeners excludes the V2 detail owner from legacy dialog watchers', () => {
    const h = fixture(); const observed = []; const Original = h.win.MutationObserver;
    h.win.MutationObserver = class extends Original { observe(node, options) { observed.push(node.id); super.observe(node, options); } };
    h.win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    h.win.HTMLDialogElement.prototype.close = function () { this.open = false; };
    const workspace = h.win.CrmProjectsWorkspace.createController({ ...h, presentationV2: true }); workspace.init(); workspace.init();
    assert.ok(!observed.includes('projects-automations'));
    assert.equal(observed.filter(id => id === 'projects-board-detail').length, 0);
    workspace.dispose(); h.dom.window.close();
});
test('utility keyboard traversal retains tab focus and open sidebar with exactly one activation', () => {
    const h = fixture(), doc = h.document;
    let opens = 0;
    const shell = h.win.CrmProjectsShellV2.createController({ ...h, openAutomations: () => opens++ }); shell.init();
    const rail = doc.getElementById('projects-workspace-rail'), toggle = doc.getElementById('projects-workspace-rail-toggle');
    rail.classList.add('is-open'); toggle.setAttribute('aria-expanded', 'true');
    doc.getElementById('projects-utab-assistant').focus();
    const steps = [['ArrowDown', 'notifications'], ['ArrowDown', 'automations'], ['End', 'recovery'], ['ArrowDown', 'assistant'], ['ArrowUp', 'recovery'], ['Home', 'assistant'], ['End', 'recovery'], ['ArrowUp', 'automations']];
    let expectedOpens = 0;
    for (const [key, name] of steps) {
        doc.activeElement.dispatchEvent(new h.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        const tab = doc.getElementById(`projects-utab-${name}`);
        assert.equal(doc.activeElement, tab, `${key} retains tab focus`);
        assert.equal(tab.getAttribute('aria-selected'), 'true');
        assert.equal(doc.getElementById(`projects-upane-${name}`).hidden, false);
        assert.equal(rail.classList.contains('is-open'), true);
        assert.equal(toggle.getAttribute('aria-expanded'), 'true');
        if (name === 'automations') expectedOpens++;
        assert.equal(opens, expectedOpens);
    }
    doc.activeElement.click();
    assert.equal(opens, expectedOpens + 1);
    assert.equal(doc.activeElement.id, 'projects-upane-automations');
    assert.equal(rail.classList.contains('is-open'), false);
    shell.dispose(); h.dom.window.close();
});

test('project menu retains original actions and Members opens the existing section; disposal restores V1',()=>{
 const h=fixture(),doc=h.document;h.win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};h.win.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const refresh=doc.getElementById('btn-projects-board-refresh'),parent=refresh.parentNode,schema=doc.getElementById('btn-projects-board-add-column'),schemaParent=schema.parentNode;
 let calls=0;refresh.addEventListener('click',()=>calls++);
 const shell=h.win.CrmProjectsShellV2.createController(h),workspace=h.win.CrmProjectsWorkspace.createController({...h,presentationV2:true});shell.init();workspace.init();shell.setSelection({selectedProjectId:'p'});
 const details=doc.querySelector('.crm-projects-view-options');assert.equal(details.querySelector('summary').getAttribute('aria-label'),'Project menu');assert.equal(refresh.closest('details'),details);assert.equal(schema.closest('details'),details);assert.equal(schema.textContent,'Add column (Owner)');
 details.open=true;refresh.click();assert.equal(calls,1);assert.equal(details.open,false);assert.equal(doc.activeElement,details.querySelector("summary"));
 details.open=true;details.dispatchEvent(new h.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(doc.activeElement,details.querySelector('summary'));
 doc.getElementById('projects-v2-members').click();assert.equal(doc.getElementById('projects-workspace-settings').open,true);assert.equal(doc.querySelector('[data-projects-settings-panel="members"]').hidden,false);assert.equal(doc.getElementById('projects-settings-tab-members').getAttribute('aria-selected'),'true');
 details.open=true;schema.click();doc.getElementById('projects-board-column-form').dispatchEvent(new h.win.Event('close'));assert.equal(doc.activeElement,details.querySelector('summary'));
 workspace.dispose();shell.dispose();assert.equal(refresh.parentNode,parent);assert.equal(schema.parentNode,schemaParent);assert.equal(schema.textContent,'+ Column');assert.equal(doc.getElementById('projects-v2-members'),null);assert.equal(details.querySelector('summary').getAttribute('aria-label'),'View options');h.dom.window.close();
});
