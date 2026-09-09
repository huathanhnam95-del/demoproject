'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
// Run the production viewport reconciler with DOM-shaped nodes. Keep editor
// identity observable without adding a browser or a synthetic rendering engine.
function fixture() {
    const start = source.indexOf('        function renderVirtualRows('), end = source.indexOf('        function renderDetail(', start);
    assert.ok(start > 0 && end > start);
    let rows = Array.from({ length: 500 }, (_, index) => ({ id: `task:${index}`, title: `Task ${index}`, writable: true, selected: false }));
    const stats = { flattened: 0, created: 0, updated: 0, countWrites: 0 };
    const container = { children: [], style: {}, appendChild(node) { this.children.push(node); node.parent = this; } };
    const makeCells = row => Array.from({ length: 35 }, (_, index) => ({ text: index === 0 ? row.title : `Column ${index}`, type: row.writable ? 'input' : 'span', checked: row.selected }));
    const createRowNode = row => {
        stats.created++; const node = { dataset: { rowId: row.id }, style: { top: `${row.index * 46}px` }, cells: makeCells(row), addEventListener() {}, remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }; return node;
    };
    const sandbox = { elements: { projectsBoardRows: container, projectsBoardScroll: { scrollTop: 0, clientHeight: 92 }, projectsBoardTable: { setAttribute() { stats.countWrites++; } } }, ROW_HEIGHT: 46, OVERSCAN: 8, logicalRows: [], document: { activeElement: null }, dragHoverTargetRowId: '', focusedRowId: '', sourceRow: '',
        flattenRows: () => { stats.flattened++; return rows; }, dragSourceRowId: () => sandbox.sourceRow, createRowNode,
        updateExistingRow(node, row, active, pinned) { stats.updated++; node.cells = makeCells(row); node.style.top = `${row.index * 46}px`; node.lastActive = active; node.lastPinned = pinned; }
    };
    vm.runInNewContext(`${source.slice(start, end)}; this.render = renderVirtualRows;`, sandbox);
    return { sandbox, stats, container, render: options => sandbox.render(options), scroll(top) { sandbox.elements.projectsBoardScroll.scrollTop = top; sandbox.render({ viewportOnly: true }); }, node: id => container.children.find(node => node.dataset.rowId === `task:${id}`), change(id, patch) { rows = rows.map(row => row.id === `task:${id}` ? { ...row, ...patch } : row); } };
}
test('viewport-only scrolling keeps mounted 35-column cells and skips flatten/update work', () => {
    const f = fixture(); f.render(); assert.equal(f.container.children.length, 10); const retained = f.node(5), cells = retained.cells;
    const before = { ...f.stats }; f.scroll(92);
    assert.equal(f.node(5), retained); assert.equal(f.node(5).cells, cells); assert.equal(f.stats.flattened, before.flattened); assert.equal(f.stats.updated, before.updated); assert.equal(f.stats.countWrites, before.countWrites);
    assert.equal(f.container.children.length, 12); assert.equal(f.stats.created - before.created, 2);
    assert.equal(f.node(11).style.top, `${11 * 46}px`);
    f.scroll(460); assert.equal(f.node(0), undefined); assert.equal(f.node(1), undefined); assert.equal(f.node(5).cells, cells);
    assert.deepEqual(f.container.children.map(node => node.dataset.rowId), Array.from({ length: 18 }, (_, index) => `task:${index + 2}`));
});
test('focused editor, drag source and hover rows stay pinned outside the viewport with bounded mounting', () => {
    const f = fixture(); f.render(); const focused = f.node(0), dragged = f.node(1), hovered = f.node(2); const editor = focused.cells[0];
    f.sandbox.document.activeElement = { closest: () => focused }; f.sandbox.sourceRow = dragged.dataset.rowId; f.sandbox.dragHoverTargetRowId = hovered.dataset.rowId;
    f.scroll(1000); assert.equal(f.node(0), focused); assert.equal(f.node(0).cells[0], editor); assert.equal(f.node(1), dragged); assert.equal(f.node(2), hovered);
    assert.ok(f.container.children.length <= 22); assert.equal(f.node(3), undefined); assert.equal(f.stats.updated, 0); assert.equal(f.stats.flattened, 1);
    f.sandbox.document.activeElement = null; f.sandbox.sourceRow = ''; f.sandbox.dragHoverTargetRowId = ''; f.scroll(1000);
    assert.equal(f.node(0), undefined); assert.equal(f.node(1), undefined); assert.equal(f.node(2), undefined); assert.ok(f.container.children.length <= 19);
});
test('subsequent default render refreshes current data, readonly permissions and selection', () => {
    const f = fixture(); f.render(); const original = f.node(5), previousCell = original.cells[0];
    f.change(5, { title: 'Renamed remotely', writable: false, selected: true });
    f.render(); assert.equal(f.stats.flattened, 2); assert.ok(f.stats.updated > 0); assert.equal(f.node(5), original); assert.notEqual(original.cells[0], previousCell);
    assert.equal(original.cells[0].text, 'Renamed remotely'); assert.equal(original.cells[0].type, 'span'); assert.equal(original.cells[0].checked, true);
    const currentCells = original.cells; f.scroll(46); assert.equal(f.node(5).cells, currentCells);
});
test('only the passive scroll listener opts into viewport-only reconciliation', () => {
    const optIns = source.match(/renderVirtualRows\(\{ viewportOnly: true \}\)/g) || [];
    assert.equal(optIns.length, 1); assert.match(source, /addEventListener\('scroll', \(\) => renderVirtualRows\(\{ viewportOnly: true \}\), \{ passive: true \}\)/);
});

test('public selectTask refreshes current task and expanded ancestors before cached scrolling without changing checkbox selection', () => {
    const f = fixture(); f.render();
    f.sandbox.tasks = new Map([['parent', { id: 'parent', title: 'Parent' }], ['child', { id: 'child', title: 'Old child', pathIds: ['child', 'parent'] }]]);
    f.sandbox.expanded = new Set(); f.sandbox.selectedTaskId = ''; f.sandbox.selectedTaskIds = ['parent'];
    f.sandbox.hasProject = () => true; f.sandbox.asArray = value => Array.isArray(value) ? value : [];
    let detailCalls = 0; f.sandbox.renderDetail = () => { detailCalls++; };
    f.sandbox.flattenRows = () => { f.stats.flattened++; return [...f.sandbox.tasks.values()].filter(task => task.id === 'parent' || f.sandbox.expanded.has('parent')).map(task => ({ ...task, id: `task:${task.id}` })); };
    f.render(); assert.equal(f.node('child'), undefined);
    const start = source.indexOf('selectTask: (task) => '), end = source.indexOf('},', start) + 1;
    assert.ok(start > 0 && end > start);
    vm.runInNewContext(`this.selectTask = ${source.slice(start + 'selectTask: '.length, end)};`, f.sandbox);
    f.sandbox.selectTask({ id: 'child', title: 'Remote child update', pathIds: ['child', 'parent'], writable: false });
    assert.equal(f.sandbox.selectedTaskId, 'child'); assert.equal(detailCalls, 1); assert.equal(f.sandbox.expanded.has('parent'), true);
    assert.equal(f.node('child').cells[0].text, 'Remote child update'); assert.equal(f.node('child').cells[0].type, 'span'); assert.deepEqual(f.sandbox.selectedTaskIds, ['parent']);
    const cells = f.node('child').cells; f.scroll(0); assert.equal(f.node('child').cells, cells);
});
