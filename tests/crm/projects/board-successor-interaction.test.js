'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require(process.env.CRM_TEST_JSDOM || 'jsdom');
const source=fs.readFileSync(process.env.BOARD_SOURCE || path.resolve(__dirname,'../../../public/js/crm/projects/board.js'),'utf8');
const tick=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){
 const dom=new JSDOM('<textarea data-assistant-instruction></textarea><section id="board"><p id="status"></p><button id="add"></button><div id="scroll"><div id="table"><div id="header"></div><div id="rows"></div></div></div></section>');
 const document=dom.window.document;
 const elements=Object.fromEntries(Object.entries({projectsBoardSection:'board',projectsBoardStatus:'status',projectsBoardAddTask:'add',projectsBoardScroll:'scroll',projectsBoardTable:'table',projectsBoardHeader:'header',projectsBoardRows:'rows'}).map(([name,id])=>[name,document.getElementById(id)]));
 let columnOrder=['A','B'],postHold=null,projectHold=null;const calls=[];
 const context={console,document,URLSearchParams,crypto:{randomUUID:()=>String(Math.random())},CSS:{escape:value=>value},setTimeout,clearTimeout,clearInterval,requestAnimationFrame:fn=>fn()};
 vm.runInNewContext(source,context);
 const board=context.CrmProjectsBoard.createController({elements,getCurrentUser:()=>({uid:'actor'}),apiFetchJson:async(url,options)=>{
  calls.push({url,method:options?.method||'GET'});
  if(options){const result=await postHold.promise;columnOrder=['B','A'];return result;}
  if(url.endsWith('/member-directory'))return{people:[]};
  if(url.includes('/tasks?'))return{tasks:[{id:'one',title:'Task One',sectionId:'s',rank:'0/1',lifecycle:'active',revision:1}],sections:[{id:'s',name:'Section',rank:'0/1'}],columns:columnOrder.map((id,index)=>({id,label:id,type:'text',rank:`${index}/1`,revision:1})),revision:{schemaRevision:1}};
  if(projectHold)await projectHold.promise;
  return{project:{id:url.split('/').pop(),lifecycle:'active',revision:1},membership:{role:'Owner'}};
 }});
 board.init();const select=id=>board.setProjects({projects:[{id,role:'Owner'}],selectedProjectId:id});select('a');
 function move(){const from=elements.projectsBoardHeader.querySelector('[data-column-id="A"]');const to=elements.projectsBoardHeader.querySelector('[data-column-id="B"]');const drag=new dom.window.Event('dragstart',{bubbles:true,cancelable:true});drag.dataTransfer={setData(){}};from.dispatchEvent(drag);to.dispatchEvent(new dom.window.Event('drop',{bubbles:true,cancelable:true}));}
 const labels=()=>[...elements.projectsBoardHeader.querySelectorAll('.crm-projects-board-column-label')].slice(5).map(node=>node.textContent);
 return{board,document,elements,calls,select,move,labels,post(){postHold=deferred();return postHold;},holdProject(){projectHold=deferred();return projectHold;},releaseProject(){projectHold=null;},busy:()=>elements.projectsBoardSection.getAttribute('aria-busy'),queue(){const gate=deferred();board.attachRemoteObserver({snapshot:async(_id,load)=>{await gate.promise;return load();},stop(){}});return gate;}};
}
test('column move stays pending through POST, another loader and delayed observer reconciliation while checkbox remains usable',async()=>{
 const h=fixture();await tick();const post=h.post(),queue=h.queue();h.move();await tick();
 assert.equal(h.busy(),'true');assert.deepEqual(h.labels(),['A','B']);
 h.elements.projectsBoardRows.querySelector('[data-action="select-task"]').click();assert.deepEqual([...h.board.getSnapshot().selectedTaskIds],['one']);
 await h.board.loadProject('a',{preserve:true,fenced:true});assert.equal(h.busy(),'true','another loader cannot clear outstanding move');
 post.resolve({schemaRevision:2});await tick();assert.equal(h.busy(),'true');assert.deepEqual(h.labels(),['A','B']);
 queue.resolve();await tick();assert.deepEqual(h.labels(),['B','A']);assert.equal(h.busy(),'false');assert.deepEqual([...h.board.getSnapshot().selectedTaskIds],['one']);
});
test('column move failure clears only its scoped pending state',async()=>{
 const h=fixture();await tick();const post=h.post();h.move();await tick();assert.equal(h.busy(),'true');post.reject(Object.assign(new Error('Move rejected'),{status:409}));await tick();assert.equal(h.busy(),'false');assert.deepEqual(h.labels(),['A','B']);assert.match(h.elements.projectsBoardStatus.textContent,/Move rejected/);
});
test('late column response cannot keep another project busy or trigger its reconciliation',async()=>{
 const h=fixture();await tick();const post=h.post();h.move();await tick();h.select('b');await tick();assert.equal(h.board.getSnapshot().project.id,'b');assert.equal(h.busy(),'false');const before=h.calls.length;post.resolve({schemaRevision:2});await tick();assert.equal(h.calls.length,before);assert.equal(h.busy(),'false');assert.equal(h.board.getSnapshot().project.id,'b');
});
test('board refresh never steals focus or caret from the mounted external instruction editor without an ID',async()=>{
 const h=fixture();await tick();h.elements.projectsBoardRows.querySelector('[data-task-id="one"]').click();
 const editor=h.document.querySelector('[data-assistant-instruction]');editor.value='Continue editing these instructions';editor.focus();editor.setSelectionRange(4,13,'backward');
 const held=h.holdProject(),refresh=h.board.refresh();await tick();assert.equal(h.document.activeElement,editor);held.resolve();await refresh;
 assert.equal(h.document.querySelector('[data-assistant-instruction]'),editor);assert.equal(h.document.activeElement,editor);assert.equal(editor.selectionStart,4);assert.equal(editor.selectionEnd,13);assert.equal(editor.selectionDirection,'backward');
});
test('normal board checkbox focus and checked selection still survive refresh',async()=>{
 const h=fixture();await tick();const checkbox=h.elements.projectsBoardRows.querySelector('[data-action="select-task"]');checkbox.focus();checkbox.click();await h.board.refresh();const current=h.elements.projectsBoardRows.querySelector('[data-action="select-task"]');assert.equal(h.document.activeElement,current);assert.equal(current.checked,true);assert.deepEqual([...h.board.getSnapshot().selectedTaskIds],['one']);
});
test('ordinary board field focus and caret remain owned by the board during remote reconciliation',async()=>{
 const h=fixture();await tick();const field=h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]');field.focus();field.setSelectionRange(2,6);
 const state=h.board.getSnapshot();await h.board.applyRemote({isCurrent:()=>true,authority:{project:{...state.project,schemaRevision:1},membership:{role:'Owner'}},changes:[{taskId:'one'}],hydration:{unavailableTaskIds:[],tasks:[{...state.tasks.get('one')}]}});
 const current=h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]');assert.equal(h.document.activeElement,current);assert.equal(current.selectionStart,2);assert.equal(current.selectionEnd,6);
});
