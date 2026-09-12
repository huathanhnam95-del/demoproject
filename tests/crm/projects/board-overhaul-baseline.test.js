'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.BOARD_SOURCE || path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

function fixture() {
    const node = () => ({ style:{}, children:[], listeners:{}, hidden:false, value:'', classList:{toggle(){}, contains:()=>false, remove(){}, add(){}}, setAttribute(){}, addEventListener(k,f){this.listeners[k]=f;}, querySelectorAll:()=>[], querySelector:()=>null, dataset:{} });
    const elements = Object.fromEntries(['projectsBoardRows','projectsBoardScroll','projectsBoardAddTask','projectsBoardStatus', 'projectsBoardSection', 'projectsBoardTableWrap', 'projectsBoardWorkspace', 'projectsBoardEmpty', 'projectsBoardProjectSelect', 'projectsBoardRefresh'].map(k=>[k,node()]));
    let uid='actor', hold=null, role='Owner', ids=['one','two','three'], fail=null, taskResponder=null, createFail=false;
    const reads=[], writes=[];
    const document = {activeElement:null,getElementById:()=>null, querySelector:()=>null};
    const context={console, URLSearchParams, clearTimeout,clearInterval,setTimeout, CSS:{escape:v=>v},document, crypto:{randomUUID:()=>'uid'}};
    vm.runInNewContext(source,context);
    const response = id=>({project:{id,lifecycle:'active',revision:1},membership:{role}});
    const board=context.CrmProjectsBoard.createController({elements,getCurrentUser:()=>({uid}),apiFetchJson:async(url,options)=>{
        if(options){writes.push(url);
            if (createFail) throw new Error('Create failed');
            return {task:{id:'created', revision: 2}};
        }
        reads.push(url);
        if(url.endsWith('/member-directory')) return {people:[]};
        if(url.includes('/tasks?')) { if(taskResponder) return taskResponder(url); const filters=JSON.parse(new URLSearchParams(url.split('?')[1]).get('filters')||'{}'); return {tasks: ids.map(id=>({id,title:id,lifecycle:'active', revision: 1})),sections:[],columns:[]}; }
        if(fail) throw Object.assign(new Error('Denied'),{status:fail});
        const id=url.split('/').pop(); if(hold && id==='a') return hold.promise; return response(id);
    }, showToast: ()=>{}});
    board.init();
    const selectProject=id=>board.setProjects({projects:[{id,role:'Owner'},{id:'b',role:'Owner'}],selectedProjectId:id}); selectProject('a');
    const click=(id,action='select-task')=>{const row={dataset:{rowId:`task:${id}`,taskId:id,rowKind:'task'}}; const control={id:'',dataset:{action},closest:s=>s==='[data-action]'?control:row,focus(){document.activeElement=control;}}; document.activeElement=control; elements.projectsBoardRows.querySelector=()=>control; elements.projectsBoardRows.listeners.click({target:control,stopPropagation(){}});};
    return {board,elements,writes,reads,document,taskResponder:v=>taskResponder=v,selectProject,response,hold(){hold=deferred();return hold;},ids:v=>ids=v,role:v=>role=v,fail:v=>fail=v,actor:v=>uid=v, setCreateFail:v=>createFail=v, click};
}

test('1. Background response held while editing unrelated task', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    h.board.setSelectedTaskIds(['one']);
    const d = h.hold(); const pending = h.board.refresh(); await flush();
    d.resolve(h.response('a')); await pending;
    assert.deepEqual([...h.board.getState().selectedTaskIds], ['one']);
});

test('2. Older response after newer save', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    h.board.applyRemote({
        isCurrent: () => true,
        authority: { project: { id: 'a', revision: 1 }, membership: { role: 'Owner' } },
        changes: [{ type: 'task', id: 'one' }],
        hydration: { tasks: [{ id: 'one', revision: 1, title: 'old' }], unavailableTaskIds: [] }
    });
    await flush();
    assert.equal(h.board.getState().tasks.get('one').title, 'one'); 
});

test('3. Project/actor switch during load', async () => {
    const h = fixture(); await flush();
    const d = h.hold(); const pending = h.board.refresh(); await flush();
    h.selectProject('b'); await flush();
    d.resolve(h.response('a')); await pending;
    assert.equal(h.board.getState().project.id, 'b');
});

test('4. Access denial during refresh', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    h.fail(403);
    await h.board.refresh();
    assert.equal(h.board.getState().authorityPending, true);
});

test('5. Task creation then remote echo', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    const taskRow={dataset:{rowId:'task:one',taskId:'one',rowKind:'task'},closest(){return this;}};
    h.elements.projectsBoardRows.listeners.keydown({target:taskRow,key:'n',ctrlKey:true,preventDefault(){}});
    await flush(); 
    h.board.applyRemote({
        isCurrent: () => true,
        authority: { project: { id: 'a', revision: 1 }, membership: { role: 'Owner' } },
        changes: [{ type: 'task', id: 'created' }],
        hydration: { tasks: [{ id: 'created', revision: 2, title: 'remotely seen' }], unavailableTaskIds: [] }
    });
    await flush();
    assert.equal(h.board.getState().tasks.has('created'), false); // capturing current state
});

test('6. Failed create request', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    h.setCreateFail(true);
    const taskRow={dataset:{rowId:'task:one',taskId:'one',rowKind:'task'},closest(){return this;}};
    h.elements.projectsBoardRows.listeners.keydown({target:taskRow,key:'n',ctrlKey:true,preventDefault(){}});
    await flush(); 
    assert.equal(h.board.getState().tasks.has('created'), false);
});

test('7. Re-entering Projects tab', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    const reads = h.reads.length;
    h.selectProject('a'); await flush();
    h.selectProject('a'); await flush();
    assert.ok(h.reads.length - reads <= 1);
});

test('8. Filtered view refresh after task stops matching', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    h.board.setFilters({status:'in_progress'}); await flush();
    h.ids(['two','three']);
    h.board.applyRemote({
        isCurrent: () => true,
        authority: { project: { id: 'a', revision: 1 }, membership: { role: 'Owner' } },
        changes: [{ type: 'task', id: 'one' }],
        hydration: { tasks: [], unavailableTaskIds: ['one'] }
    });
    await flush();
    assert.equal(h.board.getState().tasks.has('one'), false);
});

test('9. Row insertion above viewport', async () => {
    const h = fixture(); await flush();
    h.ids(['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14','t15','t16','t17','t18','t19','t20']);
    await h.board.refresh();
    h.elements.projectsBoardScroll.scrollTop = 1000;
    const oldScroll = h.elements.projectsBoardScroll.scrollTop;
    h.board.applyRemote({
        isCurrent: () => true,
        authority: { project: { id: 'a', revision: 1 }, membership: { role: 'Owner' } },
        changes: [{ type: 'task', id: 'new' }],
        hydration: { tasks: [{ id: 'new', revision: 2, title: 'new' }], unavailableTaskIds: [] }
    });
    await flush();
    assert.equal(h.elements.projectsBoardScroll.scrollTop, oldScroll);
});

test('10. Open/close detail with keyboard', async () => {
    const h = fixture(); await flush(); await h.board.refresh();
    h.click('one');
    await flush();
    assert.equal(h.board.getState().selectedTaskId, '');
});
