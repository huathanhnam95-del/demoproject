const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/ui-scale.js'), 'utf8');
const shell = fs.readFileSync(path.resolve(__dirname, '../../../public/crm-admin.html'), 'utf8');
const styles = fs.readFileSync(path.resolve(__dirname, '../../../public/css/crm-projects.css'), 'utf8');
const adminSource = fs.readFileSync(path.resolve(__dirname, '../../../public/crm-admin.js'), 'utf8');

function createUiScale(overrides = {}) {
    const sandbox = {
        globalThis: {},
        window: {},
        document: {},
        ...overrides
    };
    sandbox.globalThis = overrides.globalThis || sandbox;
    sandbox.window = overrides.window || sandbox;
    vm.runInNewContext(source, sandbox);
    return sandbox.CrmProjectsUiScale || sandbox.window?.CrmProjectsUiScale;
}

const uiScale = createUiScale();

test('CONFIG defines required constants', () => {
    assert.equal(uiScale.CONFIG.min, 70);
    assert.equal(uiScale.CONFIG.max, 150);
    assert.equal(uiScale.CONFIG.step, 5);
    assert.equal(uiScale.CONFIG.fallback, 125);
    assert.equal(uiScale.CONFIG.key, 'crm:projects:ui-scale');
});

test('validProjectsScale accepts valid integers on 5% step between 70 and 150', () => {
    for (let percent = 70; percent <= 150; percent += 5) {
        assert.equal(uiScale.validProjectsScale(percent), percent, `Expected ${percent} to be valid`);
        assert.equal(uiScale.validProjectsScale(String(percent)), percent, `Expected string "${percent}" to be valid`);
    }
});

test('validProjectsScale rejects values outside 70..150', () => {
    assert.equal(uiScale.validProjectsScale(65), null);
    assert.equal(uiScale.validProjectsScale(69), null);
    assert.equal(uiScale.validProjectsScale(151), null);
    assert.equal(uiScale.validProjectsScale(155), null);
    assert.equal(uiScale.validProjectsScale(0), null);
    assert.equal(uiScale.validProjectsScale(-100), null);
    assert.equal(uiScale.validProjectsScale(200), null);
});

test('validProjectsScale rejects non-step or non-integer values', () => {
    assert.equal(uiScale.validProjectsScale(71), null);
    assert.equal(uiScale.validProjectsScale(72), null);
    assert.equal(uiScale.validProjectsScale(99), null);
    assert.equal(uiScale.validProjectsScale(101), null);
    assert.equal(uiScale.validProjectsScale(124), null);
    assert.equal(uiScale.validProjectsScale(126), null);
    assert.equal(uiScale.validProjectsScale(125.5), null);
    assert.equal(uiScale.validProjectsScale('125.5'), null);
    assert.equal(uiScale.validProjectsScale(70.1), null);
});

test('validProjectsScale rejects malformed inputs and types', () => {
    assert.equal(uiScale.validProjectsScale(null), null);
    assert.equal(uiScale.validProjectsScale(undefined), null);
    assert.equal(uiScale.validProjectsScale(NaN), null);
    assert.equal(uiScale.validProjectsScale(Infinity), null);
    assert.equal(uiScale.validProjectsScale(-Infinity), null);
    assert.equal(uiScale.validProjectsScale(''), null);
    assert.equal(uiScale.validProjectsScale('   '), null);
    assert.equal(uiScale.validProjectsScale('125%'), null);
    assert.equal(uiScale.validProjectsScale('abc'), null);
    assert.equal(uiScale.validProjectsScale({}), null);
    assert.equal(uiScale.validProjectsScale([125]), null);
});

test('readProjectsScale returns valid value from storage', () => {
    const mockStorage = {
        store: { 'crm:projects:ui-scale': '100' },
        getItem(k) { return this.store[k] ?? null; }
    };
    assert.equal(uiScale.readProjectsScale(mockStorage), 100);
});

test('readProjectsScale falls back to 125 when storage is missing, corrupt or invalid', () => {
    const fallbackCases = [
        {},
        { 'crm:projects:ui-scale': null },
        { 'crm:projects:ui-scale': 'corrupt' },
        { 'crm:projects:ui-scale': '60' },
        { 'crm:projects:ui-scale': '200' },
        { 'crm:projects:ui-scale': '123' },
        { 'crm:projects:ui-scale': '125.5' },
        { 'crm:projects:ui-scale': '' }
    ];

    for (const store of fallbackCases) {
        const mockStorage = {
            getItem(k) { return store[k] ?? null; }
        };
        assert.equal(uiScale.readProjectsScale(mockStorage), 125);
    }
});

test('readProjectsScale falls back to 125 when storage throws SecurityError', () => {
    const throwingStorage = {
        getItem() { throw new Error('SecurityError: Access is denied'); }
    };
    assert.equal(uiScale.readProjectsScale(throwingStorage), 125);
    assert.equal(uiScale.readProjectsScale(null), 125);
    assert.equal(uiScale.readProjectsScale(undefined), 125);
});

test('applyProjectsScale updates panel custom property and input/output elements', () => {
    const customProps = {};
    const mockPanel = {
        style: {
            setProperty(prop, val) { customProps[prop] = val; },
            getPropertyValue(prop) { return customProps[prop] || ''; }
        }
    };
    const attrs = {};
    const mockInput = {
        value: '',
        setAttribute(k, v) { attrs[k] = v; }
    };
    const mockOutput = { textContent: '' };
    const mockStorage = {
        store: {},
        setItem(k, v) { this.store[k] = String(v); },
        getItem(k) { return this.store[k] ?? null; }
    };

    const applied = uiScale.applyProjectsScale(125, {
        panel: mockPanel,
        input: mockInput,
        output: mockOutput,
        storage: mockStorage,
        persist: true
    });

    assert.equal(applied, 125);
    assert.equal(customProps['--crm-projects-ui-scale'], '1.25');
    assert.equal(mockInput.value, '125');
    assert.equal(attrs['aria-valuenow'], '125');
    assert.equal(attrs['aria-valuetext'], '125%');
    assert.equal(mockOutput.textContent, '125%');
    assert.equal(mockStorage.store['crm:projects:ui-scale'], '125');
});

test('applyProjectsScale falls back to 125 for invalid percent and sanitizes panel and controls', () => {
    const customProps = {};
    const mockPanel = {
        style: { setProperty(prop, val) { customProps[prop] = val; } }
    };
    const attrs = {};
    const mockInput = {
        value: '',
        setAttribute(k, v) { attrs[k] = v; }
    };
    const mockOutput = { textContent: '' };

    const applied = uiScale.applyProjectsScale(999, {
        panel: mockPanel,
        input: mockInput,
        output: mockOutput,
        persist: false
    });

    assert.equal(applied, 125);
    assert.equal(customProps['--crm-projects-ui-scale'], '1.25');
    assert.equal(mockInput.value, '125');
    assert.equal(attrs['aria-valuenow'], '125');
    assert.equal(attrs['aria-valuetext'], '125%');
    assert.equal(mockOutput.textContent, '125%');
});

test('applyProjectsScale respects persist: false', () => {
    const mockStorage = {
        store: {},
        setItem(k, v) { this.store[k] = String(v); }
    };
    uiScale.applyProjectsScale(100, {
        panel: { style: { setProperty() {} } },
        storage: mockStorage,
        persist: false
    });
    assert.equal(mockStorage.store['crm:projects:ui-scale'], undefined);
});

test('applyProjectsScale gracefully handles storage setItem exceptions', () => {
    const throwingStorage = {
        setItem() { throw new Error('QuotaExceededError'); }
    };
    assert.doesNotThrow(() => {
        uiScale.applyProjectsScale(150, {
            panel: { style: { setProperty() {} } },
            storage: throwingStorage,
            persist: true
        });
    });
});

test('scale factors match requested calculations table', () => {
    const cases = [
        { percent: 70, factor: '0.7' },
        { percent: 100, factor: '1' },
        { percent: 125, factor: '1.25' },
        { percent: 150, factor: '1.5' }
    ];
    for (const c of cases) {
        const customProps = {};
        uiScale.applyProjectsScale(c.percent, {
            panel: { style: { setProperty(k, v) { customProps[k] = v; } } },
            persist: false
        });
        assert.equal(customProps['--crm-projects-ui-scale'], c.factor);
    }
});

test('scale control exposes an accessible unsupported-browser fallback when CSS zoom is unavailable', () => {
    const customProps = {};
    const attrs = {};
    const input = {
        value: '125',
        disabled: false,
        setAttribute(key, value) { attrs[key] = String(value); },
        addEventListener() {},
        removeEventListener() {}
    };
    const output = { textContent: '' };
    const panel = { style: { setProperty(key, value) { customProps[key] = value; } }, classList: { contains: () => false, toggle() {} } };
    const doc = {
        querySelector(selector) { return selector === '[data-panel="projects"]' ? panel : selector === '.crm-projects-view-options' ? null : null; },
        getElementById(id) { return id === 'projects-ui-scale' ? input : id === 'projects-ui-scale-value' ? output : null; },
        createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }; }
    };
    const win = { CSS: { supports: () => false }, localStorage: { getItem: () => '150' }, addEventListener() {}, removeEventListener() {} };
    const scope = createUiScale({ document: doc, window: win });
    const controller = scope.init({ elements: { projectsUiScale: input, projectsUiScaleValue: output }, panel, storage: win.localStorage });
    assert.equal(controller.supported, false);
    assert.equal(controller.getScale(), 100);
    assert.equal(customProps['--crm-projects-ui-scale'], '1');
    assert.equal(input.disabled, true);
    assert.equal(attrs['aria-disabled'], 'true');
    assert.match(output.textContent, /not supported/i);
});

test('scale controller disposal removes every listener, closes the portal and restores ownership', () => {
    const customProps = {}, inputListeners = {}, summaryListeners = {}, docListeners = {}, winListeners = {}, hosts = [];
    const input = { value: '125', setAttribute() {}, addEventListener(k, fn) { inputListeners[k] = fn; }, removeEventListener(k, fn) { if (inputListeners[k] === fn) delete inputListeners[k]; } };
    const output = { textContent: '' };
    const panel = { style: { setProperty(k, v) { customProps[k] = v; } }, classList: { contains: () => false, toggle() {} } };
    const summary = { attrs: {}, listeners: summaryListeners, setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(k, fn) { summaryListeners[k] = fn; }, removeEventListener(k, fn) { if (summaryListeners[k] === fn) delete summaryListeners[k]; }, getBoundingClientRect() { return { right: 200, bottom: 40, width: 60, height: 28 }; }, focus() {} };
    const popover = { parentNode: null, querySelector() { return null; } };
    const details = { open: false, nextElementSibling: null, querySelector(sel) { return sel === 'summary' ? summary : sel === '.crm-projects-view-options-popover' ? popover : null; }, insertBefore() {} };
    popover.parentNode = details;
    const doc = {
        querySelector(sel) { return sel === '[data-panel="projects"]' ? panel : sel === '.crm-projects-view-options' ? details : null; },
        getElementById(id) { return id === 'projects-ui-scale' ? input : id === 'projects-ui-scale-value' ? output : null; },
        createElement() { const host = { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, contains: () => false, appendChild() {}, remove() { hosts.splice(hosts.indexOf(host), 1); } }; return host; },
        createComment() { return { parentNode: details, remove() {} }; },
        body: { appendChild(host) { hosts.push(host); } },
        addEventListener(k, fn) { docListeners[k] = fn; }, removeEventListener(k, fn) { if (docListeners[k] === fn) delete docListeners[k]; }
    };
    const win = { localStorage: { getItem: () => '110', setItem() {} }, innerWidth: 1024, addEventListener(k, fn) { winListeners[k] = fn; }, removeEventListener(k, fn) { if (winListeners[k] === fn) delete winListeners[k]; } };
    const controller = createUiScale({ document: doc, window: win }).init({ elements: { projectsUiScale: input, projectsUiScaleValue: output }, panel, storage: win.localStorage });
    summaryListeners.click({ preventDefault() {} });
    assert.equal(details.open, true);
    assert.equal(hosts.length, 1);
    controller.dispose();
    assert.equal(details.open, false);
    assert.equal(summary.attrs['aria-expanded'], 'false');
    assert.equal(inputListeners.input, undefined);
    assert.equal(summaryListeners.click, undefined);
    assert.equal(summaryListeners.keydown, undefined);
    assert.equal(docListeners.pointerdown, undefined);
    assert.equal(docListeners.keydown, undefined);
    assert.equal(winListeners.resize, undefined);
    assert.equal(winListeners.hashchange, undefined);
    assert.equal(hosts.length, 0);
});

test('scale and portal markup keep stable accessible ownership outside the projects panel', () => {
    assert.match(shell, /<summary[^>]+id="projects-view-options-summary"[^>]+aria-controls="projects-view-options-popover"/);
    assert.match(shell, /<div[^>]+id="projects-view-options-popover"[^>]+aria-labelledby="projects-view-options-summary"/);
    assert.match(styles, /\.crm-projects-portal-host \.crm-projects-view-options-popover button:hover/);
    assert.match(styles, /\.crm-projects-portal-host \.crm-projects-view-options-popover button:focus-visible/);
    assert.match(styles, /\[data-panel="projects"\] dialog\.crm-projects-utility-workspace/);
    assert.match(adminSource, /projectsUiScaleController\?\.dispose\?\.\(\)\s*;[\s\S]*projectsUiScaleController\s*=.*CrmProjectsUiScale/);
});

test('init() initializes scale controller and wires DOM listeners', () => {
    const customProps = {};
    const mockPanel = {
        style: { setProperty(k, v) { customProps[k] = v; } },
        classList: { contains: () => false, toggle() {} }
    };
    const inputListeners = {};
    const inputAttrs = {};
    const mockInput = {
        value: '125',
        addEventListener(k, fn) { inputListeners[k] = fn; },
        setAttribute(k, v) { inputAttrs[k] = v; }
    };
    const mockOutput = { textContent: '' };
    const mockStorage = {
        store: { 'crm:projects:ui-scale': '110' },
        getItem(k) { return this.store[k] ?? null; },
        setItem(k, v) { this.store[k] = String(v); }
    };

    const mockSummary = {
        attrs: {},
        listeners: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(k, fn) { this.listeners[k] = fn; },
        getBoundingClientRect() { return { right: 200, bottom: 40, width: 60, height: 28 }; },
        focus() {}
    };

    const mockPopover = {
        parentNode: null,
        querySelector() { return null; }
    };
    const mockDetails = {
        open: false,
        insertBefore() {},
        appendChild() {},
        querySelector(sel) {
            if (sel === 'summary') return mockSummary;
            if (sel === '.crm-projects-view-options-popover') return mockPopover;
            return null;
        }
    };
    mockPopover.parentNode = mockDetails;

    const docListeners = {};
    const winListeners = {};
    const mockDoc = {
        querySelector(sel) {
            if (sel === '[data-panel="projects"]') return mockPanel;
            if (sel === '.crm-projects-view-options') return mockDetails;
            return null;
        },
        getElementById(id) {
            if (id === 'projects-ui-scale') return mockInput;
            if (id === 'projects-ui-scale-value') return mockOutput;
            return null;
        },
        createElement(tag) {
            return {
                tagName: tag.toUpperCase(),
                style: {},
                classList: {
                    list: new Set(),
                    add(c) { this.list.add(c); },
                    remove(c) { this.list.delete(c); },
                    contains(c) { return this.list.has(c); },
                    toggle(c, force) { if (force) this.list.add(c); else this.list.delete(c); }
                },
                appendChild() {},
                remove() {}
            };
        },
        createComment() { return { parentNode: mockDetails, remove() {} }; },
        body: { appendChild() {} },
        addEventListener(k, fn) { docListeners[k] = fn; },
        removeEventListener(k) { delete docListeners[k]; }
    };

    const mockWindow = {
        localStorage: mockStorage,
        innerWidth: 1024,
        addEventListener(k, fn) { winListeners[k] = fn; },
        removeEventListener(k) { delete winListeners[k]; }
    };

    const testScope = createUiScale({
        document: mockDoc,
        window: mockWindow
    });

    const controller = testScope.init({
        elements: { projectsUiScale: mockInput, projectsUiScaleValue: mockOutput },
        panel: mockPanel,
        storage: mockStorage
    });

    assert.ok(controller, 'controller must be returned');
    assert.equal(controller.getScale(), 110);
    assert.equal(customProps['--crm-projects-ui-scale'], '1.1');
    assert.equal(mockInput.value, '110');
    assert.equal(mockOutput.textContent, '110%');
    assert.equal(mockSummary.attrs['aria-expanded'], 'false');

    // Simulate slider drag to 85%
    assert.ok(inputListeners.input, 'input listener must be registered');
    inputListeners.input({ target: { value: '85' } });
    assert.equal(customProps['--crm-projects-ui-scale'], '0.85');
    assert.equal(mockInput.value, '85');
    assert.equal(mockOutput.textContent, '85%');
    assert.equal(mockStorage.store['crm:projects:ui-scale'], '85');

    // Toggle summary to open portal
    assert.ok(mockSummary.listeners.click, 'summary click listener must exist');
    let prevented = false;
    mockSummary.listeners.click({ preventDefault() { prevented = true; } });
    assert.ok(prevented, 'default details click must be intercepted');
    assert.equal(mockDetails.open, true);
    assert.equal(mockSummary.attrs['aria-expanded'], 'true');

    // Toggle summary to close portal
    mockSummary.listeners.click({ preventDefault() {} });
    assert.equal(mockDetails.open, false);
    assert.equal(mockSummary.attrs['aria-expanded'], 'false');

    // Clean disposal
    assert.doesNotThrow(() => controller.dispose());
});
