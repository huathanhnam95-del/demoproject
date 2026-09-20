'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for (let i=0;i<16;i++) await new Promise(setImmediate); };
async function fixture(v2 = true, width = 1280) {
    const dom = new JSDOM(fs.readFileSync(path.join(root,'public/crm-admin.html'),'utf8'), {runScripts:'outside-only',url:'https://fixture.invalid',pretendToBeVisual:true});
    const win=dom.window, doc=win.document;
    let currentWidth = width; const observers = [];
    win.ResizeObserver = class { constructor(callback){ observers.push(callback); } observe(){} disconnect(){} };
    doc.querySelector('[data-panel="projects"]').getBoundingClientRect=()=>({width:currentWidth});
    for(const name of ['presentation/column-model','presentation/table-layout','presentation/field-feedback','state','presentation/detail-surface','board','date-picker']) win.eval(fs.readFileSync(path.join(root,`public/js/crm/projects/${name}.js`),'utf8'));
    win.HTMLDialogElement.prototype.show = win.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
    win.HTMLDialogElement.prototype.close = function(){this.open=false;};
    win.CrmProjectsDatePicker.init();
    doc.querySelector('[data-panel="projects"]').setAttribute('data-projects-ui',v2?'v2':'legacy');
    const admin=fs.readFileSync(path.join(root,'public/crm-admin.js'),'utf8');
    const elements=Object.fromEntries([...admin.matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m=>[m[1],doc.getElementById(m[2])]));
    let actor='a',role='Owner',fail=0,malformed=false,hold=null,readHold=null,branchResponder=null;
    const columns=[{id:'notes',label:'Notes',type:'text'},{id:'estimate',label:'Estimate',type:'number'},{id:'deadline',label:'Deadline',type:'date'},{id:'importance',label:'Priority',type:'priority'},{id:'phase',label:'Phase',type:'status',statusLabels:{done:'Finished'}},{id:'choice',label:'Choice',type:'dropdown',options:[{key:'yes',label:'Yes'}]},{id:'team',label:'Team',type:'people'},{id:'future',type:'future'}];
    let task={id:'t',sectionId:'s',title:'Tiếng Việt <img src=x>',status:'not_started',rank:'0/1',revision:1,activeChildCount:0,ownerUid:'a',assigneeUids:['b','former'],startDate:'2026-09-01',dueDate:'2026-09-20',values:{notes:'Stored',estimate:0,importance:'high',phase:'done',choice:'removed',team:['former'],future:{safe:'<script>'}}};
    const tasks=Array.from({length:70},(_,i)=>({...task,id:i?`t${i}`:'t',rank:`${i}/1`}));
    const writes=[],events=[];
    const board=win.CrmProjectsBoard.createController({elements,presentationV2:v2,getCurrentUser:()=>({uid:actor}),onFieldSaveEvent:e=>events.push(e),apiFetchJson:async(url,options)=>{
        if(options){const body=JSON.parse(options.body||'{}');writes.push({url,body}); if(hold){const wait=hold;hold=null;await wait;}
            if(fail)throw Object.assign(new Error('Fixture denied/conflict/unconfirmed'),fail===-1?{}:{status:fail});
            if(malformed)return {ok:true};
            if(url.endsWith('/schedule-preview')){previewDates={startDate:body.startDate,dueDate:body.dueDate};return {preview:{token:'preview-token',canApply:true,taskId:'t',after:{startDate:body.startDate,dueDate:body.dueDate},workingDayCount:12,warnings:[]}};}
            if(url.endsWith('/schedule-apply')){task={...task,...previewDates,revision:task.revision+1};tasks[0]=task;return {result:{task}};}
            task={...task,...body,values:{...task.values,...body.values},revision:task.revision+1};tasks[0]=task;return {task};}
        if(url.includes('member-directory'))return {people:[{uid:'a',displayName:'Owner A'},{uid:'b',displayName:'Collaborator B'},{uid:'c',displayName:'Nguyễn C'}]};
        if(url.includes('/tasks?'))return branchResponder ? branchResponder(url) : {tasks,columns,sections:[{id:'s',title:'Section',rank:'0/1'},{id:'s2',title:'Other',rank:'1/1'}],revision:{schemaRevision:1,structureRevision:1}};
        if(url.endsWith('/tasks/t')){if(readHold){const wait=readHold;readHold=null;await wait;}return {task};}
        if(/\/tasks\/[^/?]+$/.test(url))return {task:board.getState().tasks.get(url.split('/').pop())};
        return {project:{id:url.split('/').pop(),lifecycle:'active'},membership:{role}};
    }});
    let previewDates={startDate:'2026-09-02',dueDate:'2026-09-21'};
    board.init();const select=id=>board.setProjects({projects:[{id,lifecycle:'active'}],selectedProjectId:id});select('p');await tick();
    return {resize(width){currentWidth=width;observers.forEach(cb=>cb());},win,doc,board,elements,writes,events,columns,tasks,select,remote(patch){task={...task,...patch,revision:task.revision+1};tasks[0]=task;board.updateTask(task);},branches:fn=>branchResponder=fn,row:()=>doc.querySelector('[data-task-id="t"]'),key:(el,key,extra={})=>el.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra})),change:el=>el.dispatchEvent(new win.Event('change',{bubbles:true})),input:el=>el.dispatchEvent(new win.Event('input',{bubbles:true})),actor:v=>actor=v,role:v=>role=v,fail:v=>fail=v,malformed:()=>malformed=true,holdRead(){let release;readHold=new Promise(r=>release=r);return release;},hold(){let release;hold=new Promise(r=>release=r);return release;},close(){board.disposePresentation();win.close();}};
}


test('container List has bounded logical semantics, explicit paging and no invented project total',async()=>{
 const h=await fixture(true,390);try{
  const table=h.elements.projectsBoardTable,rows=h.elements.projectsBoardRows;
  assert.equal(table.dataset.presentation,'list');assert.equal(table.getAttribute('role'),'presentation');
  assert.equal(rows.getAttribute('role'),'list');assert.equal(rows.style.height,'auto');
  assert.equal(rows.children.length,50);assert.equal(table.hasAttribute('aria-rowcount'),false);
  assert.equal(rows.children[49].getAttribute('aria-posinset'),'50');assert.equal(rows.children[49].getAttribute('aria-setsize'),'50');
  assert.equal(rows.querySelectorAll('[role="cell"]').length,0);
  h.doc.querySelector('[data-mobile-more]').click();assert.ok(rows.children.length>50);assert.equal(h.doc.querySelector('[data-mobile-more]').hidden,true);
  assert.equal(h.doc.activeElement.dataset.rowId,rows.children[50].dataset.rowId);
 }finally{h.close();}
});
test('zero hidden measurement is ignored and resize retains rename node, caret and draft',async()=>{
 const h=await fixture();try{
  const row=h.row();h.key(row,'F2');const input=h.row().querySelector('[data-field-kind="title"]');
  input.value='Bản nháp tiếng Việt còn giữ nguyên';h.input(input);input.focus();input.setSelectionRange(4,7);
  h.resize(390);assert.equal(h.row().querySelector('[data-field-kind="title"]'),input);assert.equal(h.doc.activeElement,input);assert.equal(input.selectionStart,4);
  h.resize(0);assert.equal(h.elements.projectsBoardTable.dataset.presentation,'list');
  h.resize(980);assert.equal(h.elements.projectsBoardTable.dataset.presentation,'table');assert.equal(h.doc.activeElement,input);assert.equal(input.selectionEnd,7);assert.equal(h.writes.length,0);
  assert.equal(h.elements.projectsBoardTable.getAttribute('aria-rowcount'),'75');
 }finally{h.close();}
});
test('one navigation row, native controls, Escape return and loaded End mount are coherent',async()=>{
 const h=await fixture();try{
  const rows=h.elements.projectsBoardRows;assert.equal(rows.querySelectorAll('[data-row-id][tabindex="0"]').length,1);
  h.row().focus();h.key(h.row(),'ArrowDown');assert.equal(h.doc.activeElement.dataset.taskId,'t1');
  assert.equal(rows.querySelectorAll('[data-row-id][tabindex="0"]').length,1);
  const title=h.doc.activeElement.querySelector('[data-action="open-detail"]');title.focus();h.key(title,'ArrowDown');assert.equal(h.doc.activeElement,title);
  h.key(title,'Escape');assert.equal(h.doc.activeElement.dataset.taskId,'t1');
  h.key(h.doc.activeElement,'End');assert.equal(h.doc.activeElement.dataset.sectionId,'s2');h.key(h.doc.activeElement,'ArrowUp');assert.equal(h.doc.activeElement.dataset.taskId,'t69');
  const ordered=[...rows.children].map(n=>Number(n.getAttribute('aria-rowindex')));assert.deepEqual(ordered,[...ordered].sort((a,b)=>a-b));
  h.key(h.doc.activeElement,' ');assert.equal(h.doc.activeElement.querySelector('[data-action="select-task"]').checked,true);
 }finally{h.close();}
});
test('mobile status and owner use canonical writes and picker Escape owns dismissal',async()=>{
 const h=await fixture(true,390);try{
  const trigger=h.row().querySelector('[data-action="pick-status"]');assert.match(trigger.getAttribute('aria-label'),/Change status for Tiếng Việt/);
  trigger.click();assert.equal(trigger.getAttribute('aria-expanded'),'true');const chosen=h.doc.querySelector('[data-status-key="done"]');
  h.key(chosen,'Escape');assert.equal(h.doc.querySelector('.crm-status-popover'),null);assert.equal(h.doc.activeElement,trigger);assert.equal(trigger.getAttribute('aria-expanded'),'false');
  trigger.click();h.doc.querySelector('[data-status-key="done"]').click();await tick();assert.equal(h.writes[0].body.status,'done');assert.equal(h.writes[0].body.expectedRevision,1);
  h.row().querySelector('[data-people-kind="ownerUid"]').click();h.doc.querySelector('[data-people-uid="c"]').click();await tick();assert.equal(h.writes[1].body.ownerUid,'c');
 }finally{h.close();}
});
for(const boundary of ['actor','project','access'])test(`mobile delayed editor completion respects ${boundary} boundary`,async()=>{
 const h=await fixture(true,390);try{
  const release=h.hold();h.row().querySelector('[data-action="pick-status"]').click();h.doc.querySelector('[data-status-key="done"]').click();await tick();
  if(boundary==='actor'){h.actor('other');h.board.invalidateAccess('p');}
  else if(boundary==='project'){h.select('other');await tick();}
  else {h.role('Viewer');h.board.invalidateAccess('p');}
  release();await tick();assert.equal(h.doc.querySelector('.crm-status-popover'),null);assert.equal(h.writes.length,1);
  if(boundary==='access') assert.equal(h.board.getState().authorizationReady,false);
 }finally{h.close();}
});
test('legacy flag-off keeps table presentation and no mobile controller',async()=>{
 const h=await fixture(false,390);try{assert.equal(h.elements.projectsBoardTable.dataset.presentation,undefined);assert.equal(h.doc.querySelector('[data-mobile-more]'),null);}finally{h.close();}
});

test('mobile essentials survive desktop column preferences and return without changing preferences',async()=>{
 const h=await fixture();try{
  h.board.setColumnPreferences({hidden:['ownerUid','status']});assert.equal(h.row().querySelector('[data-column-key="ownerUid"]'),null);
  h.resize(390);assert.ok(h.row().querySelector('[data-column-key="ownerUid"]'));assert.ok(h.row().querySelector('[data-column-key="status"]'));
  h.resize(1280);assert.equal(h.row().querySelector('[data-column-key="ownerUid"]'),null);
 }finally{h.close();}
});
test('invalid field errors are associated with controls and announce useful text',async()=>{
 const h=await fixture();try{
  const input=h.row().querySelector('.crm-board-field[data-column-id="notes"]');h.fail(409);input.value='Bản nháp cần xem lại';h.input(input);h.change(input);await tick();
  const current=h.row().querySelector('.crm-board-field[data-column-id="notes"]');const feedback=h.doc.getElementById(current.getAttribute('aria-describedby'));
  assert.ok(feedback);assert.equal(current.getAttribute('aria-invalid'),'true');assert.equal(feedback.getAttribute('role'),'status');assert.match(feedback.textContent,/Conflict|review|Fixture/);
  assert.equal(h.writes.length,1);assert.equal(current.value,'Bản nháp cần xem lại');
 }finally{h.close();}
});
test('passive virtual scroll retains one navigation entry and quick-create footer is keyboard reachable',async()=>{
 const h=await fixture();try{
  h.elements.projectsBoardScroll.scrollTop=2500;h.elements.projectsBoardScroll.dispatchEvent(new h.win.Event('scroll'));await tick();
  assert.equal(h.elements.projectsBoardRows.querySelectorAll('[data-row-id][tabindex="0"]').length,1);
  h.key(h.elements.projectsBoardRows.querySelector('[data-row-id][tabindex="0"]'),'End');
  assert.ok([...h.elements.projectsBoardRows.querySelectorAll('[data-action="quick-task"]')].every(n=>n.tabIndex===0));
 }finally{h.close();}
});


async function hierarchyFixture() {
 const h=await fixture(true,390);const reads=[];
 h.remote({activeChildCount:1});
 h.branches(url=>{const q=new URL(url,'https://fixture.invalid'),parent=JSON.parse(q.searchParams.get('filters')).parentTaskId;reads.push({parent,cursor:q.searchParams.get('cursor')});return {tasks:[{id:parent==='t'?'child':'grandchild',title:'Công việc con',parentTaskId:parent,sectionId:'s',rank:'0/1',revision:1,activeChildCount:parent==='t'?1:0}]};});
 const opener=h.row().querySelector('[data-action="open-subtasks"]');opener.focus();opener.click();await tick();return {...h,reads,opener};
}

for(const backCount of [0,1,2])for(const dismissal of ['close','Escape','cancel'])test(`descendant ${dismissal} after ${backCount} Back restores the originating logical task after real remount`,async()=>{
 const h=await hierarchyFixture();try{
  h.doc.querySelector('[data-detail-child="child"]').click();await tick();
  h.doc.querySelector('[data-detail-child="grandchild"]').click();await tick();
  for(let i=0;i<backCount;i++){h.doc.querySelector('[data-detail-parent]').click();await tick();}
  h.remote({title:'Origin remounted'});assert.equal(h.opener.isConnected,false);
  assert.equal(h.elements.projectsBoardTable.dataset.presentation,'list');
  if(dismissal==='close')h.doc.getElementById('btn-projects-board-close-detail').click();
  else if(dismissal==='Escape')h.key(h.doc.activeElement,'Escape');
  else h.elements.projectsBoardDetail.dispatchEvent(new h.win.Event('cancel',{cancelable:true}));
  assert.equal(h.elements.projectsBoardDetail.open,false);
  assert.equal(h.doc.activeElement.closest('#projects-board-rows [data-task-id]')?.dataset.taskId,'t');
 }finally{h.close();}
});

test('descendant close reveals an originating task moved beyond the mounted mobile prefix',async()=>{
 const h=await fixture(true,390);try{
  h.remote({rank:'1000/1',activeChildCount:1});
  assert.equal(h.row(),null,'origin is outside the initial mounted prefix');
  h.branches(url=>{const parent=JSON.parse(new URL(url,'https://fixture.invalid').searchParams.get('filters')).parentTaskId;return {tasks:[{id:parent==='t'?'child':'grandchild',parentTaskId:parent,title:'Child',revision:1,rank:'0/1',activeChildCount:parent==='t'?1:0}]};});
  h.board.selectTask(h.board.getState().tasks.get('t'));await tick();
  h.doc.querySelector('[data-detail-child="child"]').click();await tick();
  h.doc.querySelector('[data-detail-child="grandchild"]').click();await tick();
  assert.equal(h.row(),null,'origin is outside the initial mounted prefix');
  h.board.closeTask();
  assert.equal(h.doc.activeElement.closest('[data-task-id]')?.dataset.taskId,'t');
  assert.ok(h.row());
 }finally{h.close();}
});

for(const boundary of ['archived','actor','access','project'])test(`descendant close cannot restore an origin across ${boundary}`,async()=>{
 const h=await hierarchyFixture();try{
  h.doc.querySelector('[data-detail-child="child"]').click();await tick();
  if(boundary==='archived')h.remote({lifecycle:'archived'});
  else if(boundary==='actor')h.actor('other');
  else if(boundary==='access')h.board.invalidateAccess('p');
  else {h.select('other');await tick();}
  const outside=h.doc.createElement('button');h.doc.body.append(outside);outside.focus();
  h.board.closeTask();
  assert.equal(h.elements.projectsBoardDetail.open,false);
  assert.equal(h.doc.activeElement.closest('#projects-board-rows [data-task-id]'),null);
  if(boundary==='archived'||boundary==='actor')assert.equal(h.doc.activeElement.id,'projects-workspace-name');
  else assert.equal(h.doc.activeElement,outside,'scope reset leaves no stale restoration session');
 }finally{h.close();}
});

for(const restore of [false,true])test(`filtered origin ${restore?'returns and is focused':'uses a safe fallback without changing filters'}`,async()=>{
 const h=await hierarchyFixture();try{
  h.doc.querySelector('[data-detail-child="child"]').click();await tick();
  h.doc.querySelector('[data-detail-child="grandchild"]').click();await tick();
  const roots=[...h.board.getState().tasks.values()].filter(t=>!t.parentTaskId);
  h.branches(url=>{const filters=JSON.parse(new URL(url,'https://fixture.invalid').searchParams.get('filters'));return {tasks:filters.parentTaskId?[]:roots.filter(t=>!filters.search||t.id!== 't'),sections:[{id:'s',title:'Section',rank:'0/1'}],columns:h.columns};});
  await h.board.setFilters({search:'other tasks'});await tick();
  assert.equal(h.row(),null);assert.equal(h.board.getState().selectedTaskId,'grandchild');
  if(restore){await h.board.setFilters({});await tick();}
  h.board.closeTask();
  if(restore)assert.equal(h.doc.activeElement.closest('[data-task-id]')?.dataset.taskId,'t');
  else {assert.equal(h.doc.activeElement.id,'projects-workspace-name');assert.equal(h.board.getState().filters.search,'other tasks');}
 }finally{h.close();}
});

test('explicit live opener wins; detached explicit opener falls back to its canonical origin and close resets it',()=>{
 const dom=new JSDOM('<body><button id="first">First</button><button id="next">Next</button><dialog><button>Child</button></dialog></body>',{runScripts:'outside-only',pretendToBeVisual:true});
 const win=dom.window,doc=win.document,dialog=doc.querySelector('dialog'),fallback=[];
 dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
 win.eval(fs.readFileSync(path.join(root,'public/js/crm/projects/presentation/detail-surface.js'),'utf8'));
 const surface=win.CrmProjectsDetailSurfaceV2.createController({dialog,panel:{getBoundingClientRect:()=>({width:390})},fallbackFocus:id=>fallback.push(id)});surface.init();
 try{
  const first=doc.getElementById('first'),next=doc.getElementById('next');
  surface.sync({id:'t0'},{opener:first});surface.sync({id:'t1'},{preserveOrigin:true});surface.sync({id:'t2'},{opener:next});
  surface.requestClose();assert.equal(doc.activeElement,next);assert.deepEqual(fallback,[]);
  surface.sync({id:'temporary'},{opener:next});next.remove();surface.sync({id:'child'},{preserveOrigin:true});surface.replaceTaskId('temporary','canonical');surface.requestClose();
  assert.deepEqual(fallback,['canonical']);
  surface.sync({id:'new'},{opener:first});first.remove();surface.requestClose();assert.deepEqual(fallback,['canonical','new']);
 }finally{surface.dispose();win.close();}
});
test('mobile Overview loads canonical children and traverses descendants then returns to parent at constant width',async()=>{
 const h=await hierarchyFixture();try{
  assert.equal(h.reads[0]?.parent,'t');
  h.doc.querySelector('[data-detail-child="child"]').click();await tick();
  assert.equal(h.board.getState().selectedTaskId,'child');assert.equal(h.reads[1]?.parent,'child');
  h.doc.querySelector('[data-detail-child="grandchild"]').click();await tick();
  assert.equal(h.board.getState().selectedTaskId,'grandchild');
  h.doc.querySelector('[data-detail-parent]').click();assert.equal(h.board.getState().selectedTaskId,'child');
  h.doc.querySelector('[data-detail-parent]').click();assert.equal(h.board.getState().selectedTaskId,'t');
  assert.equal(h.elements.projectsBoardTable.dataset.presentation,'list');
 }finally{h.close();}
});
test('mobile child prefix is bounded and explicit load-more failure retries the same canonical cursor',async()=>{
 const h=await fixture(true,390);try{
  h.remote({activeChildCount:80});let calls=0;const cursors=[];
  h.branches(url=>{const q=new URL(url,'https://fixture.invalid');cursors.push(q.searchParams.get('cursor'));calls++;if(calls===2)throw Error('Child page failed');return {tasks:Array.from({length:calls===1?60:20},(_,i)=>({id:'child'+(calls===1?i:i+60),title:'Con '+i,parentTaskId:'t',rank:`${calls===1?i:i+60}/1`,revision:1})),nextCursor:calls===1?'page2':null};});
  h.board.selectTask(h.board.getState().tasks.get('t'));await tick();
  assert.equal(h.doc.querySelectorAll('[data-detail-child]').length,50);
  h.doc.querySelector('[data-detail-children-more]').click();await tick();
  assert.equal(h.doc.querySelectorAll('[data-detail-child]').length,60);assert.equal(calls,1);
  h.doc.querySelector('[data-detail-children-more]').click();await tick();
  assert.match(h.doc.querySelector('[data-detail-children-status]').textContent,/could not be loaded/i);
  h.doc.querySelector('[data-detail-children-more]').click();await tick();
  assert.equal(h.doc.querySelectorAll('[data-detail-child]').length,80);assert.deepEqual(cursors,[null,'page2','page2']);
 }finally{h.close();}
});
for(const boundary of ['actor','project','access'])for(const reject of [false,true])test(`mobile child ${reject?'failure':'result'} cannot cross stale ${boundary} scope`,async()=>{
 const h=await fixture(true,390);try{
  h.remote({activeChildCount:1});let release;
  h.branches(()=>new Promise((resolve,no)=>release=()=>reject?no(Object.assign(Error('Old denied'),{status:403})):resolve({tasks:[{id:'secret-child',title:'Old private child',parentTaskId:'t',revision:1}]})));
  h.board.selectTask(h.board.getState().tasks.get('t'));await tick();assert.equal(typeof release,'function');
  h.branches(()=>({tasks:[]}));
  if(boundary==='actor'){h.actor('other');h.board.invalidateAccess('p');}
  else if(boundary==='project'){h.select('other');await tick();}
  else{h.role('Viewer');h.board.invalidateAccess('p');}
  release();await tick();
  assert.equal(h.board.getState().tasks.has('secret-child'),false);assert.equal(h.doc.querySelector('[data-detail-child]'),null);
  assert.equal(h.elements.projectsBoardDetail.open,false);
  if(boundary==='project')assert.equal(h.board.getState().authorizationReady,true);
 }finally{h.close();}
});

test('a child page completing after internal navigation is available when returning to its parent',async()=>{
 const h=await fixture(true,390);try{
  h.remote({activeChildCount:2});h.tasks.push({id:'existing',title:'Existing child',parentTaskId:'t',revision:1,activeChildCount:0});await h.board.refresh();let release;
  h.branches(()=>new Promise(resolve=>release=()=>resolve({tasks:[{id:'late-child',title:'Late child',parentTaskId:'t',revision:1}]})));
  h.board.selectTask(h.board.getState().tasks.get('t'));await tick();
  h.doc.querySelector('[data-detail-child="existing"]').click();await tick();release();await tick();
  assert.equal(h.board.getState().selectedTaskId,'existing');assert.equal(h.doc.querySelector('[data-detail-child="late-child"]'),null);
  h.doc.querySelector('[data-detail-parent]').click();await tick();
  assert.ok(h.doc.querySelector('[data-detail-child="late-child"]'));
 }finally{h.close();}
});

test('retrying the first failed child read still mounts only the initial bounded prefix',async()=>{
 const h=await fixture(true,390);try{
  h.remote({activeChildCount:60});let fail=true;
  h.branches(()=>{if(fail)throw Error('Unavailable');return {tasks:Array.from({length:60},(_,i)=>({id:'c'+i,title:'Child '+i,parentTaskId:'t',rank:`${i}/1`,revision:1}))};});
  h.board.selectTask(h.board.getState().tasks.get('t'));await tick();
  assert.equal(h.doc.querySelector('[data-detail-children-more]').textContent,'Retry loading subtasks');
  fail=false;h.doc.querySelector('[data-detail-children-more]').click();await tick();
  assert.equal(h.doc.querySelectorAll('[data-detail-child]').length,50);
 }finally{h.close();}
});

test('returning from a child beyond the first prefix reveals and focuses that child',async()=>{
 const h=await fixture(true,390);try{
  h.remote({activeChildCount:60});
  h.branches(()=>({tasks:Array.from({length:60},(_,i)=>({id:'c'+i,title:'Child '+i,parentTaskId:'t',rank:`${i}/1`,revision:1,activeChildCount:0}))}));
  h.board.selectTask(h.board.getState().tasks.get('t'));await tick();
  h.doc.querySelector('[data-detail-children-more]').click();h.doc.querySelector('[data-detail-child="c59"]').click();
  h.doc.querySelector('[data-detail-parent]').click();
  assert.equal(h.doc.activeElement.dataset.detailChild,'c59');
  assert.equal(h.doc.querySelectorAll('[data-detail-child]').length,60);
 }finally{h.close();}
});

test('phone leaves omit zero-child context, selection label toggles once, and menu retains Add subtask',async()=>{
 const h=await fixture(true,390);try {
  const row=h.row(),box=row.querySelector('[data-action="select-task"]'),label=box.closest('label');assert.ok(label);box.focus();label.click();assert.equal(h.doc.activeElement,box);assert.equal(box.isConnected,true);assert.equal(box.checked,true);assert.deepEqual(Array.from(h.board.getState().selectedTaskIds),['t']);h.row().querySelector('.crm-board-selection-hit').click();assert.equal(h.board.getState().selectedTaskIds.length,0);
  assert.ok(!row.querySelector('[data-action="open-subtasks"]') || row.querySelector('[data-action="open-subtasks"]').hidden);
  h.row().querySelector('[data-action="task-menu"]').click();assert.equal(h.doc.querySelector('[data-add-child]').textContent,'Add subtask');h.doc.querySelector('[data-add-child]').click();assert.ok(h.doc.querySelector('[data-quick-create]'));assert.equal(h.writes.length,0);
 }finally{h.close();}
});
