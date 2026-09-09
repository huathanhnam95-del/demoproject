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
    const node = () => ({ style:{}, children:[], listeners:{}, hidden:false, value:'', classList:{toggle(){}}, setAttribute(){}, addEventListener(k,f){this.listeners[k]=f;}, querySelectorAll:()=>[], querySelector:()=>null });
    const elements = Object.fromEntries(['projectsBoardRows','projectsBoardScroll','projectsBoardAddTask','projectsBoardStatus'].map(k=>[k,node()]));
    let uid='actor', hold=null, branchHold=null, role='Owner', ids=['one','two','three'], fail=null, branchData=null, taskResponder=null;
    const reads=[], snapshots=[];
    const writes=[];
    const document = {activeElement:null,getElementById:()=>null};
    const context={console, URLSearchParams, clearTimeout,clearInterval,setTimeout, CSS:{escape:v=>v},document};
    vm.runInNewContext(source,context);
    const response = id=>({project:{id,lifecycle:'active',revision:1},membership:{role}});
    const board=context.CrmProjectsBoard.createController({elements,getCurrentUser:()=>({uid}),onContextChanged:state=>snapshots.push({ids:[...state.tasks.keys()],selected:[...state.selectedTaskIds]}),apiFetchJson:async(url,options)=>{
        if(options){writes.push(url);return {};}
        reads.push(url);
        if(url.endsWith('/member-directory')) return {people:[]};
        if(url.includes('/tasks?')) { if(taskResponder) return taskResponder(url); if(branchHold) await branchHold.promise; const parent=JSON.parse(new URLSearchParams(url.split('?')[1]).get('filters')).parentTaskId || '__root__'; return {tasks:branchData ? (branchData[parent] || []) : ids.map(id=>({id,title:id,lifecycle:'active'})),sections:[],columns:[]}; }
        if(fail) throw Object.assign(new Error('Denied'),{status:fail});
        const id=url.split('/').pop(); if(hold && id==='a') return hold.promise; return response(id);
    }});
    board.init();
    const selectProject=id=>board.setProjects({projects:[{id,role:'Owner'}],selectedProjectId:id}); selectProject('a');
    const click=(id,action='select-task')=>{const row={dataset:{rowId:`task:${id}`,taskId:id,rowKind:'task'}}; const control={id:'',dataset:{action},closest:s=>s==='[data-action]'?control:row,focus(){document.activeElement=control;}}; document.activeElement=control; elements.projectsBoardRows.querySelector=()=>control; elements.projectsBoardRows.listeners.click({target:control,stopPropagation(){}});};
    return {board,elements,writes,reads,snapshots,document,taskResponder:value=>taskResponder=value,attachObserver() { document.hidden=true;document.addEventListener=()=>{};document.removeEventListener=()=>{};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../public/js/crm/projects/remote-observer.js'),'utf8'),context);board.attachRemoteObserver(context.CrmProjectsRemoteObserver.createController({getCurrentUser:()=>({uid}),apiFetchJson:async()=>({cursor:'start',authority:{signature:'owner'}})})); },click,toggle:id=>click(id,'toggle-task'),branchData:value=>branchData=value,selectProject,response,hold(){hold=deferred();return hold;},holdBranch(){branchHold=deferred();return branchHold;},ids:v=>ids=v,role:v=>role=v,fail:v=>fail=v,actor:v=>uid=v};
}
test('rapid checkbox actions while both project and task GETs are held survive atomic replacement; latest focus/scroll wins',async()=>{
    const h=fixture();await flush();h.click('one');const d=h.hold();const pending=h.board.refresh();await flush();
    h.click('two');h.click('three');h.elements.projectsBoardScroll.scrollTop=239;h.elements.projectsBoardScroll.scrollLeft=31;
    assert.deepEqual([...h.board.getState().selectedTaskIds],['one','two','three']);assert.equal(h.elements.projectsBoardAddTask.disabled,true);assert.equal(h.board.getState().authorityPending,true);assert.equal(h.board.getState().authorizationReady,false);
    const taskRow={dataset:{rowId:'task:one',taskId:'one',rowKind:'task'},closest(){return this;}};
    h.elements.projectsBoardRows.listeners.keydown({target:taskRow,key:'n',ctrlKey:true,preventDefault(){}});await flush();assert.equal(h.writes.length,0);
    const branches=h.holdBranch();d.resolve(h.response('a'));await flush();h.click('two');h.click('two');const latestActive=h.document.activeElement;assert.equal(h.board.getState().tasks.size,3);
    h.ids(['one','three']);branches.resolve();await pending;
    assert.deepEqual([...h.board.getState().selectedTaskIds],['one','three']);assert.equal(h.board.getState().tasks.has('two'),false);
    assert.equal(h.elements.projectsBoardScroll.scrollTop,239);assert.equal(h.elements.projectsBoardScroll.scrollLeft,31);assert.equal(h.document.activeElement,latestActive);
    assert.equal(h.writes.length,0);assert.equal(h.elements.projectsBoardAddTask.disabled,false);assert.equal(h.board.getState().authorizationReady,true);assert.equal(h.board.getState().filterOptionsReady,true);
});
test('late project response cannot replace switched project or its selection',async()=>{
    const h=fixture();await flush();const d=h.hold();const pending=h.board.refresh();await flush();h.selectProject('b');await flush();h.click('two');d.resolve(h.response('a'));await pending;
    assert.equal(h.board.getState().project.id,'b');assert.deepEqual([...h.board.getState().selectedTaskIds],['two']);
});
for(const status of [401,403,404]) test(`denied ${status} clears retained content and selection`,async()=>{const h=fixture();await flush();h.click('one');h.fail(status);await h.board.refresh();assert.equal(h.board.getState().project,null);assert.equal(h.board.getState().tasks.size,0);assert.deepEqual([...h.board.getState().selectedTaskIds],[]);});
test('Viewer downgrade preserves selected tasks while pending and settled mutations remain blocked',async()=>{
    const h=fixture();await flush();h.click('one');h.role('Viewer');const b=h.holdBranch();const pending=h.board.refresh();await flush();assert.deepEqual([...h.board.getState().selectedTaskIds],['one']);assert.equal(h.board.getState().membership.role,'Viewer');assert.equal(h.elements.projectsBoardAddTask.disabled,true);
    const row={dataset:{rowId:'task:one',taskId:'one',rowKind:'task'},closest(){return this;}};
    const attemptWrite=()=>h.elements.projectsBoardRows.listeners.keydown({target:row,key:'n',ctrlKey:true,preventDefault(){}});
    attemptWrite();await flush();assert.equal(h.writes.length,0);b.resolve();await pending;
    assert.deepEqual([...h.board.getState().selectedTaskIds],['one']);assert.equal(h.elements.projectsBoardAddTask.disabled,true);attemptWrite();await flush();assert.equal(h.writes.length,0);
});
test('transient failure keeps selectable read model but does not restore stale write authority',async()=>{const h=fixture();await flush();h.fail(503);await h.board.refresh();assert.equal(h.board.getState().filterOptionsReady,false);h.click('two');assert.deepEqual([...h.board.getState().selectedTaskIds],['two']);assert.equal(h.elements.projectsBoardAddTask.disabled,true);});
test('actor change clears retained state and late response cannot resurrect it',async()=>{const h=fixture();await flush();h.click('one');const d=h.hold();const pending=h.board.refresh();await flush();h.actor('different');d.resolve(h.response('a'));await pending;assert.equal(h.board.getState().tasks.size,0);assert.equal(h.elements.projectsBoardAddTask.disabled,true);});
test('same-project selection callback during held refresh issues no duplicate load and preserves current expansion', async () => {
    const h=fixture();await flush();h.branchData({'__root__':[{id:'root'}],root:[{id:'child',parentTaskId:'root'}],child:[{id:'leaf',parentTaskId:'child'}]});await h.board.refresh();
    const held=h.hold(), pending=h.board.refresh();await flush();const before=h.reads.filter(url=>url==='/api/projects/a').length;
    h.selectProject('a');h.toggle('root');await flush();held.resolve(h.response('a'));await pending;await flush();
    assert.equal(h.reads.filter(url=>url==='/api/projects/a').length,before);assert.equal(h.board.getState().tasks.has('child'),true);
    h.toggle('child');await flush();assert.equal(h.board.getState().tasks.has('leaf'),true);
});
test('refresh retains unloaded nested expansion intents and reopening fetches only reachable expanded descendants', async () => {
    const h=fixture();await flush();h.branchData({'__root__':[{id:'root'},{id:'other'}],root:[{id:'child',parentTaskId:'root'}],child:[{id:'leaf',parentTaskId:'child'}],other:[{id:'unwanted',parentTaskId:'other'}]});await h.board.refresh();
    h.toggle('root');await flush();h.toggle('child');await flush();assert.equal(h.board.getState().tasks.has('leaf'),true);
    h.toggle('root');await flush();await h.board.refresh();assert.equal(h.board.getState().tasks.has('child'),false);
    const before=h.reads.length;h.toggle('root');await flush();assert.equal(h.board.getState().tasks.has('leaf'),true);
    const loaded=h.reads.slice(before).filter(url=>url.includes('/tasks?')).map(url=>JSON.parse(new URLSearchParams(url.split('?')[1]).get('filters')).parentTaskId);
    assert.deepEqual(loaded,['root','child']);assert.equal(h.board.getState().tasks.has('unwanted'),false);
});
test('known removed ancestor clears descendant expansion intent without fetching its missing subtree', async () => {
    const h=fixture();await flush();h.branchData({'__root__':[{id:'root'}],root:[{id:'child',parentTaskId:'root'}],child:[{id:'leaf',parentTaskId:'child'}]});await h.board.refresh();h.toggle('root');await flush();h.toggle('child');await flush();
    h.branchData({'__root__':[]});await h.board.refresh();const before=h.reads.length;
    h.branchData({'__root__':[{id:'root'}],root:[{id:'child',parentTaskId:'root'}],child:[{id:'leaf',parentTaskId:'child'}]});await h.board.refresh();
    assert.equal(h.board.getState().tasks.has('child'),false);assert.equal(h.reads.slice(before).filter(url=>url.includes('/tasks?')).length,1);
});
for (const observer of [false,true]) test(`filter changes fence held pages and queued refreshes without losing current selection (observer=${observer})`, async () => {
    const h=fixture();await flush();if(observer) h.attachObserver();h.click('one');
    const oldPage=deferred(),latestPage=deferred();const queries=[];
    h.taskResponder(url=>{const params=new URLSearchParams(url.split('?')[1]);const filters=JSON.parse(params.get('filters'));queries.push({status:filters.status,cursor:params.get('cursor')});
        if(filters.status==='in_progress') return oldPage.promise;
        if(!params.get('cursor')) return latestPage.promise;
        return {tasks:[{id:'two'}],sections:[],columns:[],nextCursor:null};
    });
    const old=h.board.setFilters({status:'in_progress'});await flush();h.click('two');const latest=h.board.setFilters({status:'done'});
    oldPage.resolve({tasks:[{id:'stale-old'}],sections:[],columns:[],nextCursor:'old-second'});await flush();
    assert.deepEqual(queries,[{status:'in_progress',cursor:null},{status:'done',cursor:null}]);
    assert.deepEqual([...h.board.getState().selectedTaskIds],['one','two']);assert.equal(h.board.getState().filterOptionsReady,false);
    assert.equal(h.board.getState().tasks.has('stale-old'),false);assert.equal(h.snapshots.some(state=>state.ids.includes('stale-old')),false);
    latestPage.resolve({tasks:[{id:'one'}],sections:[],columns:[],nextCursor:'new-second'});await Promise.all([old,latest]);
    assert.deepEqual(queries,[{status:'in_progress',cursor:null},{status:'done',cursor:null},{status:'done',cursor:'new-second'}]);
    assert.deepEqual([...h.board.getState().tasks.keys()],['one','two']);assert.deepEqual([...h.board.getState().selectedTaskIds],['one','two']);assert.equal(h.board.getState().filterOptionsReady,true);
});
