'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
const root = path.resolve(__dirname, '../../..');
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/crm/projects/presentation/column-model.js'), 'utf8'), context);
const model = context.CrmProjectsColumnsV2;
const schema = [{ id: 'priority', type: 'priority' }, { id: 'new', type: 'future', label: 'Future value' }];
test('canonical descriptors retain real IDs, seed one priority and preserve unknown columns read-only', () => {
    const cols = model.resolve(schema);
    assert.equal(cols.map(c => c.key).join(','), 'taskTitle,ownerUid,status,dates,custom:priority,assigneeUids,custom:new');
    assert.equal(cols.at(-1).readonly, true);
    assert.equal(cols.at(-1).source, schema[1]);
    assert.equal(model.resolve([...schema, { id: 'other', type: 'priority' }])[4].key, 'assigneeUids');
});
test('malformed preference fields clamp widths, keep identity and drop absent keys without changing schema', () => {
    const cols = model.resolve(schema, { order: ['custom:new', 'custom:new', 'missing', 'status'], hidden: ['taskTitle', 'dates', 'missing'], widths: { taskTitle: -1, status: 9000, 'custom:new': '200' } });
    assert.equal(cols.map(c => c.key).join(','), 'taskTitle,custom:priority,status,ownerUid,assigneeUids,custom:new');
    assert.equal(cols[0].width, 300); assert.equal(cols[2].width, 320); assert.equal(cols[1].width, 160);
    const layout = model.geometry(cols); assert.equal(layout.minimumWidth, cols.reduce((n,c) => n+c.width,0));
    assert.equal(layout.template, cols.map(c => `${c.width}px`).join(' '));
});
test('virtual window subtracts sticky header once and bounds live rows at large offsets', () => {
    for (const count of [30, 500, 5000]) for (const height of [36, 44, 54, 66]) {
        const top = Math.max(0, count * height - (600 - 36));
        const range = model.windowRange(count, height, top, 600, 36);
        assert.equal(range.last, count); assert.ok(range.last - range.first < 34);
        assert.ok(range.first <= Math.floor(top / height));
    }
});
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
async function boardFixture(storage, taskCount = 1, branch = false) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://fixture.invalid' });
    const win = dom.window, doc = win.document;
    for (const name of ['presentation/column-model', 'presentation/table-layout', 'state', 'board']) win.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    const admin = fs.readFileSync(path.join(root, 'public/crm-admin.js'), 'utf8');
    const elements = Object.fromEntries([...admin.matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m => [m[1], doc.getElementById(m[2])]));
    const task = { id: 't', sectionId: 's', title: 'Title', status: 'blocked', revision: 1, values: { text: 'Stored', unknown: { preserved: true } } };
    const tasks = Array.from({length: taskCount}, (_, i) => ({...task, id: i ? `t${i}` : 't', rank: `${i}/1`}));
    if (branch) { tasks[0].childCount=1; tasks[1].parentTaskId='t'; tasks[1].ancestorIds=['t']; }
    const columns = [{ id: 'text', type: 'text' }, { id: 'unknown', type: 'future' }];
    let actor = 'a'; const writes = [];
    const board = win.CrmProjectsBoard.createController({ elements, presentationV2: true, presentationStorage: storage, getCurrentUser: () => ({uid:actor}), apiFetchJson: async (url, options) => {
        if (options) { const body = JSON.parse(options.body || '{}'); writes.push({url,body}); return {task:{...task,...body,revision:2}}; }
        if (url.includes('member-directory')) return { people: [] };
        if (url.includes('/tasks?')) {
            const parent = JSON.parse(new URL(url, 'https://fixture.invalid').searchParams.get('filters') || '{}').parentTaskId;
            return { tasks: tasks.filter(t => parent ? t.parentTaskId===parent : !t.parentTaskId), columns, sections: [{id:'s', title:'Section',rank:'0/1'}], revision:{schemaRevision:1,structureRevision:1} };
        }
        return {project:{id:'p',lifecycle:'active'},membership:{role:'Owner'}};
    } });
    board.init(); board.setProjects({projects:[{id:'p',lifecycle:'active'}],selectedProjectId:'p'});
    for(let i=0;i<15;i++) await new Promise(setImmediate);
    assert.equal(board.getState().authorizationReady,true);
    return {board,win,doc,elements,writes,task,setActor:uid=>{actor=uid;},close:()=>{board.disposePresentation();dom.window.close();}};
}
test('keyed reconciliation retains a focused custom draft across reorder/hide and unknown values stay read-only', async () => {
    const h = await boardFixture();
    try {
        const row = h.doc.querySelector('[data-task-id="t"]'), editor = row.querySelector('input[data-column-id="text"]');
        editor.focus(); editor.value = 'Uncommitted draft'; editor.setSelectionRange(3,7); editor.dispatchEvent(new h.win.Event('input',{bubbles:true}));
        h.board.setColumnPreferences({order:['custom:unknown','status','custom:text'],hidden:['ownerUid'],widths:{'custom:text':220}});
        assert.equal(h.doc.activeElement,editor); assert.equal(editor.value,'Uncommitted draft'); assert.equal(editor.selectionStart,3);
        assert.equal(row.children[1].dataset.columnKey,'custom:text');
        assert.equal(row.querySelector('[data-column-key="ownerUid"]'),null);
        assert.equal(row.querySelector('[data-column-key="custom:unknown"] input'),null);
        assert.match(row.querySelector('[data-column-key="custom:unknown"]').textContent,/preserved.*true.*unavailable/);
        const headerKeys=[...h.elements.projectsBoardHeader.children].map(c=>c.dataset.columnKey);
        assert.deepEqual([...row.children].map(c=>c.dataset.columnKey),headerKeys);
        // Row 2 is the section title and row 3 its column labels.
        assert.equal(row.getAttribute('aria-rowindex'),'4');
        assert.equal(h.writes.length,0); assert.deepEqual(h.task.values.unknown,{preserved:true});
    } finally {h.close();}
});
function assertLogicalDomOrder(h) {
    const rows = [...h.elements.projectsBoardRows.children];
    const indices = rows.map(row => Number(row.getAttribute('aria-rowindex')));
    assert.deepEqual(indices, [...indices].sort((a,b) => a-b), 'mounted and pinned rows follow logical order');
    assert.equal(new Set(rows.map(row => row.dataset.rowId)).size, rows.length);
    assert.ok(rows.length < 40, 'DOM stays bounded');
}
test('rank reconciliation preserves the focused row, draft, selection and caret while ordering DOM', async () => {
    const h = await boardFixture(undefined, 30);
    try {
        const row = h.doc.querySelector('[data-task-id="t7"]');
        row.querySelector('[data-action="select-task"]').click();
        const editor = row.querySelector('input[data-column-id="text"]');
        editor.focus(); editor.value = 'Retained draft'; editor.setSelectionRange(2,6,'backward');
        editor.dispatchEvent(new h.win.Event('input',{bubbles:true}));
        h.board.updateTask({...h.board.getState().tasks.get('t7'), rank:'-1/1', revision:2});
        assertLogicalDomOrder(h);
        assert.equal(h.doc.querySelector('[data-task-id="t7"]'), row);
        assert.equal(h.doc.activeElement, editor); assert.equal(editor.value, 'Retained draft');
        assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 6); assert.equal(editor.selectionDirection, 'backward');
        assert.equal(row.querySelector('[data-action="select-task"]').checked, true);
        assert.equal(h.writes.length, 0);
    } finally { h.close(); }
});
test('reverse scrolling inserts new rows before retained rows and a focused offscreen pin', async () => {
    const h = await boardFixture(undefined, 500);
    try {
        const scroll = h.elements.projectsBoardScroll;
        const move = top => { scroll.scrollTop=top; scroll.dispatchEvent(new h.win.Event('scroll')); };
        move(2000);
        const row = h.elements.projectsBoardRows.querySelector('[data-row-kind="task"]');
        const editor = row.querySelector('input[data-column-id="text"]'); editor.focus();
        move(1800); assertLogicalDomOrder(h);
        assert.equal(h.doc.activeElement, editor); assert.equal(editor.closest('[data-row-id]'), row);
        move(0); assertLogicalDomOrder(h);
        assert.equal(h.doc.activeElement, editor); assert.ok(row.isConnected);
        assert.equal(h.writes.length, 0);
    } finally { h.close(); }
});
test('branch expansion inserts its loaded child before the next retained root', async () => {
    const h = await boardFixture(undefined, 30, true);
    try {
        const root = h.doc.querySelector('[data-task-id="t"]'), next = h.doc.querySelector('[data-task-id="t2"]');
        assert.equal(h.doc.querySelector('[data-task-id="t1"]'), null);
        root.querySelector('[data-action="toggle-task"]').click();
        for (let i=0;i<15;i++) await new Promise(setImmediate);
        assertLogicalDomOrder(h);
        assert.equal(root.nextElementSibling.dataset.taskId, 't1');
        // The expanded branch ends with its "+ Add subtask" row.
        assert.equal(root.nextElementSibling.nextElementSibling.dataset.rowId, 'subadd:t');
        assert.equal(root.nextElementSibling.nextElementSibling.nextElementSibling, next);
        assert.equal(h.doc.querySelector('[data-task-id="t"]'), root);
        assert.equal(h.writes.length, 0);
    } finally { h.close(); }
});
test('fallback DOM moves keep the drag source attached and restore a separate editor caret', async () => {
    const h = await boardFixture(undefined, 30);
    try {
        h.elements.projectsBoardRows.moveBefore = undefined;
        const source = h.doc.querySelector('[data-task-id="t4"]');
        const drag = new h.win.Event('dragstart', {bubbles:true});
        drag.dataTransfer = {setData(){}}; source.dispatchEvent(drag);
        const editor = h.doc.querySelector('[data-task-id="t7"] input[data-column-id="text"]');
        editor.focus(); editor.value='Drag draft'; editor.setSelectionRange(1,4,'backward');
        editor.dispatchEvent(new h.win.Event('input',{bubbles:true}));
        const mutations = new h.win.MutationObserver(()=>{});
        mutations.observe(h.elements.projectsBoardRows, {childList:true});
        h.board.updateTask({...h.board.getState().tasks.get('t7'), rank:'-1/1', revision:2});
        assertLogicalDomOrder(h);
        assert.ok(mutations.takeRecords().every(record => ![...record.removedNodes].includes(source)), 'drag source never detached');
        mutations.disconnect();
        assert.equal(h.doc.activeElement, editor); assert.equal(editor.value,'Drag draft');
        assert.equal(editor.selectionStart,1); assert.equal(editor.selectionEnd,4); assert.equal(editor.selectionDirection,'backward');
        assert.equal(h.writes.length,0);
        source.dispatchEvent(new h.win.Event('dragend',{bubbles:true}));
    } finally { h.close(); }
});
test('column preferences persist per actor/project, restore topology, and reject stale actor writes', async () => {
    const data = new Map(), storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
    let h=await boardFixture(storage);
    h.board.setColumnPreferences({hidden:['dates'],widths:{status:250,'custom:text':230}});
    assert.equal(JSON.parse(data.get('crm:projects:v2:columns:1:a:p')).widths.status,250);
    const before=JSON.stringify([...data]);h.setActor('other');h.board.setColumnPreferences({hidden:['status']});assert.equal(JSON.stringify([...data]),before);
    h.board.disposePresentation(); assert.equal(h.elements.projectsBoardScroll.parentNode,h.elements.projectsBoardTable);h.close();
    h=await boardFixture(storage);
    assert.equal(h.board.getColumnPreferences().widths['custom:text'],230);assert.equal(h.board.getColumnPreferences().hidden[0],'dates');h.close();
    h=await boardFixture({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
    h.board.setColumnPreferences({widths:{status:190}}); assert.equal(h.board.getColumnPreferences().widths.status,190);h.close();
});
test('status remains the canonical mutation field after personal column reorder', async () => {
    const h = await boardFixture();
    try {
        h.board.setColumnPreferences({order:['custom:text','dates','status']});
        const control=h.doc.querySelector('[data-task-id="t"] [data-column-key="status"] select[data-field-kind="status"]');
        control.value='done';control.dispatchEvent(new h.win.Event('change',{bubbles:true}));
        for(let i=0;i<15;i++) await new Promise(setImmediate);
        assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.status,'done');assert.equal(h.writes[0].body.values,undefined);
        assert.match(h.writes[0].url,/\/tasks\/t$/);
    } finally {h.close();}
});

test('stored width and visibility snapshots follow later shared custom column ordering',()=>{
    const original=[{id:'first',type:'text'},{id:'second',type:'text'}];
    const saved=model.normalize({widths:{'custom:first':230},hidden:['custom:second']},original);
    const reordered=model.normalize(saved,[original[1],original[0]]);
    assert.deepEqual(Array.from(reordered.order.filter(k=>k.startsWith('custom:'))),['custom:second','custom:first']);
    assert.equal(reordered.widths['custom:first'],230);assert.deepEqual(Array.from(reordered.hidden),['custom:second']);
});
for (const surface of ['shared','section']) test(`pointer resize on ${surface} header batches frames, flushes once on release and restores on cancellation`,async()=>{
    const stored=[];const h=await boardFixture({getItem:()=>null,setItem:(key,value)=>stored.push(JSON.parse(value))});try{
        const frames=new Map();let next=0;
        h.win.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};
        h.win.cancelAnimationFrame=id=>frames.delete(id);
        const handle=()=>(surface==='shared'?h.elements.projectsBoardHeader:h.elements.projectsBoardRows.querySelector('[data-row-kind="group-header"]')).querySelector('[data-column-resize="status"]');
        const pointer=(node,type,x)=>{node.setPointerCapture=()=>{};const event=new h.win.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:1});node.dispatchEvent(event);};
        const width=()=>Number(handle().getAttribute('aria-valuenow'));
        const before=width();pointer(handle(),'pointerdown',100);pointer(handle(),'pointermove',110);pointer(handle(),'pointermove',125);
        assert.equal(width(),before);assert.equal(frames.size,1);
        const captured=handle();const callback=[...frames.values()][0];frames.clear();callback();assert.equal(handle(),captured);assert.equal(width(),before+25);assert.equal(stored.length,0);
        pointer(handle(),'pointermove',130);pointer(handle(),'pointerup',140);
        assert.equal(width(),before+40);assert.equal(stored.length,1);assert.equal(frames.size,0);
        pointer(handle(),'pointerdown',100);pointer(handle(),'pointermove',140);pointer(handle(),'pointercancel',140);
        assert.equal(width(),before+40);assert.equal(stored.length,2);assert.equal(frames.size,0);
    }finally{h.close();}
});
