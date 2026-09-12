'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const cssSource = fs.readFileSync(path.resolve(__dirname, '../../../public/css/crm-projects.css'), 'utf8');
const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../public/crm-admin.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Small DOM adapter: exercise controller events and mounted rows without a browser dependency.
class Node {
    constructor(tag = 'div', attrs = {}) {
        this.tagName = tag.toUpperCase(); this.attrs = {}; this.dataset = {}; this.children = []; this.listeners = {};
        this.style = { setProperty(name, value) { this[name] = value; } }; this.value = ''; this.textContent = '';
        this.classList = { contains: name => this.className.split(' ').includes(name), add: name => { this.className += ` ${name}`; }, toggle: () => {} };
        Object.entries(attrs).forEach(([key, value]) => this.setAttribute(key, value));
    }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = value; }
    get childNodes() { return this.children; }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    setAttribute(key, value) { this.attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); if (key === 'value') this.value = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    hasAttribute(key) { return key in this.attrs; }
    removeAttribute(key) { delete this.attrs[key]; }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get type() { return this.attrs.type || ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
    insertBefore(child, sibling) { child.remove(); child.parent = this; this.children.splice(this.children.indexOf(sibling), 0, child); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    replaceWith(next) { const parent = this.parent, index = parent.children.indexOf(this); next.remove(); parent.children[index] = next; next.parent = parent; this.parent = null; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.split(',').some(part => { part = part.trim(); if (part.startsWith('.')) return this.classList.contains(part.slice(1)); const match = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/); return match ? this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]) : this.tagName.toLowerCase() === part; }); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(html) {
        this.children = []; const stack = [this];
        for (const match of html.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
            const token = match[0]; if (token.startsWith('</')) { stack.pop(); continue; }
            if (!token.startsWith('<')) { stack.at(-1).textContent += token.trim(); continue; }
            const tag = token.match(/^<([a-z]+)/i)[1], attrs = {};
            for (const attribute of token.slice(tag.length + 1, -1).matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[attribute[1]] = attribute[2] || '';
            const child = stack.at(-1).appendChild(new Node(tag, attrs));
            if (!['input', 'br', 'hr'].includes(tag)) stack.push(child);
        }
    }
}
function fixture() {
    const elements = Object.fromEntries(['projectsBoardRows', 'projectsBoardScroll', 'projectsBoardAddTask', 'projectsBoardDetail', 'projectsBoardCount'].map(name => [name, new Node()]));
    let uid = 'actor', held = null;
    const selections = [], writes = [], reads = [];
    const document = { activeElement: null, getElementById: () => null, createElement: () => { const template = new Node(); Object.defineProperty(template, 'content', { get: () => ({ firstElementChild: template.children[0] }) }); return template; } };
    const context = { console, document, URLSearchParams, CSS: { escape: value => value }, setTimeout, clearTimeout, clearInterval };
    vm.runInNewContext(source, context);
    const branch = {
        __root__: [{ id: 'root', sectionId: 'group', title: 'Root', ownerUid: 'actor', status: 'done', activeChildCount: 1, revision: 1, derived: { activeLeafCount: 1, completedLeafCount: 1, completionPercent: 100 } }],
        root: [{ id: 'child', parentTaskId: 'root', effectiveSectionId: 'group', title: 'Child', activeChildCount: 1 }],
        child: [{ id: 'leaf', parentTaskId: 'child', effectiveSectionId: 'group', title: 'Leaf', activeChildCount: 0 }]
    };
    const board = context.CrmProjectsBoard.createController({ elements, getCurrentUser: () => ({ uid }), onTaskSelection: task => selections.push(task?.id || null), apiFetchJson: async (url, options) => {
        if (options) { writes.push(url); return {}; }
        reads.push(url);
        if (url.endsWith('/member-directory')) return { people: [{ uid: 'actor', displayName: 'Alex Nguyen' }] };
        if (url.includes('/tasks?')) { const filters = JSON.parse(new URLSearchParams(url.split('?')[1]).get('filters')); return { tasks: branch[filters.parentTaskId || '__root__'] || [], sections: [{ id: 'group', title: 'Delivery', color: 'url(unsafe)' }], columns: [] }; }
        if (held) await held.promise;
        return { project: { id: url.split('/').pop(), lifecycle: 'active', revision: 1 }, membership: { role: 'Owner' } };
    } });
    board.init();
    const select = id => board.setProjects({ projects: [{ id, role: 'Owner' }], selectedProjectId: id });
    select('a');
    const row = id => elements.projectsBoardRows.querySelector(`[data-row-id="${id}"]`);
    const click = node => { document.activeElement = node; elements.projectsBoardRows.listeners.click({ target: node, stopPropagation() {} }); };
    return { board, elements, selections, writes, reads, document, row, click, select, actor: value => { uid = value; }, hold: () => (held = deferred()), ids: () => elements.projectsBoardRows.children.map(node => node.dataset.rowId) };
}

test('group collapse hides its expanded hierarchy, preserves focus and restores it through refresh/filtering', async () => {
    const h = fixture(); await flush();
    h.click(h.row('task:root').querySelector('[data-action="toggle-task"]')); await flush();
    h.click(h.row('task:child').querySelector('[data-action="toggle-task"]')); await flush();
    assert.deepEqual(h.ids(), ['section:group', 'task:root', 'task:child', 'task:leaf']);
    const toggle = h.row('section:group').querySelector('[data-action="toggle-section"]');
    h.click(toggle); assert.deepEqual(h.ids(), ['section:group']); assert.equal(h.elements.projectsBoardRows.style.height, '46px');
    assert.equal(h.document.activeElement, toggle); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    await h.board.setFilters({ status: 'done' }); assert.deepEqual(h.ids(), ['section:group']);
    h.click(toggle); assert.deepEqual(h.ids(), ['section:group', 'task:root', 'task:child', 'task:leaf']);
    assert.equal(h.elements.projectsBoardRows.style.height, '184px');
    h.click(toggle); h.select('b'); await flush(); assert.deepEqual(h.ids(), ['section:group', 'task:root']);
});

test('native edits keep details closed, explicit details select task, and presentation follows retained rows', async () => {
    const h = fixture(); await flush(); h.selections.length = 0;
    const row = h.row('task:root');
    for (const kind of ['title', 'status', 'ownerUid', 'startDate']) h.click(row.querySelector(`[data-field-kind="${kind}"]`));
    assert.deepEqual(h.selections, []);
    assert.equal(row.querySelector('[data-field-kind="status"]').getAttribute('data-status'), 'done');
    assert.equal(row.querySelector('.crm-board-owner-avatar').textContent, 'AN');
    const detailButton = row.querySelector('[data-action="open-detail"]');
    h.click(detailButton); assert.deepEqual(h.selections, ['root']);
    assert.equal(h.document.activeElement, detailButton); assert.equal(h.elements.projectsBoardRows.contains(detailButton), true);
    const status = h.row('task:root').querySelector('[data-field-kind="status"]'); status.value = 'blocked';
    h.elements.projectsBoardRows.listeners.input({ target: status });
    h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    assert.equal(h.row('task:root').querySelector('.crm-board-status-cell').getAttribute('data-status'), 'blocked');
});

test('collapse during pending authority remains local and actor changes clear mounted content', async () => {
    const h = fixture(); await flush(); const held = h.hold(); const pending = h.board.refresh(); await flush();
    assert.equal(h.board.getState().authorityPending, true);
    h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    assert.deepEqual(h.ids(), ['section:group']); assert.equal(h.elements.projectsBoardAddTask.disabled, true);
    const task = new Node('div', { 'data-row-id': 'task:root', 'data-task-id': 'root', 'data-row-kind': 'task' });
    h.elements.projectsBoardRows.listeners.keydown({ target: task, key: 'n', ctrlKey: true, preventDefault() {} }); await flush(); assert.deepEqual(h.writes, []);
    h.actor('different'); h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    assert.equal(h.board.getState().project, null); assert.deepEqual(h.ids(), []);
    held.resolve(); await pending; assert.equal(h.board.getState().tasks.size, 0); assert.deepEqual(h.writes, []);
});

test('board presentation removes redundant chrome while preserving section collapse, progress data, and keyboard semantics', async () => {
    const h = fixture(); await flush();
    const section = h.row('section:group');
    assert.equal(section.children.length, 1, 'Section bands should not reserve a second cell for a root-task badge');
    const sectionToggle = section.querySelector('[data-action="toggle-section"]');
    assert.ok(sectionToggle, 'Section collapse control must remain available');
    assert.equal(sectionToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(h.elements.projectsBoardCount.textContent, '', 'The alternate loaded/section count must stay empty');

    const task = h.row('task:root');
    assert.equal(task.querySelector('.crm-board-progress-ring'), null, 'Read-only completion ring should not be mounted beside task titles');
    assert.deepEqual(h.board.getState().tasks.get('root')?.derived, { activeLeafCount: 1, completedLeafCount: 1, completionPercent: 100 }, 'Underlying derived task data must remain available for progress/statistics consumers');
    assert.match(task.getAttribute('aria-description'), /Alt\+Right indents; Alt\+Left outdents/);
    assert.match(task.getAttribute('aria-description'), /Tab navigates controls/);
    assert.doesNotMatch(htmlSource, /class="crm-projects-board-hints"/, 'The always-visible keyboard-help row should be removed from the shell');
    assert.doesNotMatch(cssSource, /crm-board-progress-ring/, 'Progress-ring CSS should be removed when its only renderer is removed');
    assert.doesNotMatch(cssSource, /crm-projects-board-row \.crm-board-status-cell::after/, 'Decorative status chevron should not be styled');
});

test('board headers expose visible column dividers and center data labels without shifting editable titles', () => {
    assert.match(cssSource, /\.crm-projects-board-header > div \{[^}]*border-right: 1px solid var\(--pj-line-strong\)/s);
    assert.match(cssSource, /\.crm-projects-board-row > div \{[^}]*border-right: 1px solid var\(--pj-line-strong\)/s);
    assert.doesNotMatch(cssSource, /\.crm-projects-board-header > div \{[^}]*border-right: 1px solid transparent/s);
    assert.doesNotMatch(cssSource, /\.crm-projects-board-row > div \{[^}]*border-right: 1px solid transparent/s);
    assert.match(cssSource, /\.crm-projects-board-header > div:not\(:first-child\)\s*\{[^}]*justify-content:\s*center/s);
    assert.match(cssSource, /\.crm-projects-board-column-editable\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) 24px/s);
    assert.match(cssSource, /\.crm-projects-board-column-edit\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/s);
    assert.match(source, /class="crm-projects-board-column-edit"[^>]*data-action="edit-column"[^>]*aria-label="Edit column/);
});
