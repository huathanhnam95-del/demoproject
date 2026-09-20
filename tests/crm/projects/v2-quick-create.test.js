'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for(let i=0;i<15;i++) await new Promise(setImmediate); };
async function fixture(v2=true) {
    const dom=new JSDOM(fs.readFileSync(path.join(root,'public/crm-admin.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://fixture.invalid'});
    const win=dom.window,doc=win.document;
    for(const name of ['presentation/column-model','presentation/table-layout','presentation/field-feedback','state','board']) win.eval(fs.readFileSync(path.join(root,`public/js/crm/projects/${name}.js`),'utf8'));
    const elements=Object.fromEntries([...fs.readFileSync(path.join(root,'public/crm-admin.js'),'utf8').matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m=>[m[1],doc.getElementById(m[2])]));
    let responder=null;
    let actor='a',role='Owner',hold=null,fail=0,malformed=false,seq=0,structure=1;
    const tasks=[{id:'t',title:'Parent',sectionId:'s',effectiveSectionId:'s',rank:'0/1',revision:1,status:'not_started',activeChildCount:1},{id:'child',title:'Nested',parentTaskId:'t',effectiveSectionId:'s',ancestorIds:['t'],rank:'0/1',revision:1},{id:'u',title:'Other',sectionId:'s',rank:'1/1',revision:1}];
    const sections=[{id:'s',title:'Tiếng Việt',rank:'0/1'},{id:'z',title:'Other',rank:'1/1'}],writes=[],events=[],receipts=new Map();
    const board=win.CrmProjectsBoard.createController({elements,presentationV2:v2,getCurrentUser:()=>({uid:actor}),onCreationEvent:e=>events.push(e),apiFetchJson:async(url,opts)=>{
        if(!opts){if(url.includes('member-directory'))return {people:[]};if(url.includes('/tasks?'))return {tasks:structuredClone(tasks),sections:sections.slice(),columns:[],revision:{structureRevision:structure,schemaRevision:1}};return {project:{id:url.split('/').pop(),lifecycle:'active'},membership:{role}};}
        const body=JSON.parse(opts.body);writes.push({url,body});if(hold){const p=hold;hold=null;await p;}
        if(responder){const custom=await responder(url,body);if(custom!==undefined)return custom;}
        if(fail)throw Object.assign(Error('Synthetic denied/conflict/network'),fail<0?{}:{status:fail});
        if(malformed)return {ok:true};if(receipts.has(body.operationId))return receipts.get(body.operationId);
        let result;
        if(url.endsWith('/tasks')){const task={...body,id:`new${++seq}`,revision:1,rank:`${seq+2}/1`,effectiveSectionId:body.sectionId,status:'not_started'};tasks.push(task);result={task,structureRevision:++structure};}
        else if(url.endsWith('/sections')){const section={id:`sec${++seq}`,title:body.title,rank:'3/1',revision:1};sections.push(section);result={section,structureRevision:++structure};}
        else if(url.endsWith('/bulk')){const c=body.changes[0],t=tasks.find(t=>t.id===c.taskId);assert.equal(c.expectedRevision,t.revision);Object.assign(t,c.patch,{revision:t.revision+1});result={updated:[{taskId:t.id,revision:t.revision}],count:1};}
        else if(url.endsWith('/move')){const t=tasks.find(t=>url.includes(`/tasks/${t.id}/`));assert.equal(body.expectedStructureRevision,structure);Object.assign(t,{sectionId:body.sectionId,parentTaskId:null,revision:t.revision+1});const {effectiveSectionId,ancestorIds,pathIds,activeChildCount,...persisted}=t;result={task:persisted,structureRevision:++structure};}
        else if(url.endsWith('/archive')){const t=tasks.find(t=>url.includes(`/tasks/${t.id}/`));t.lifecycle='archived';result={targetId:t.id,lifecycle:'archived',structureRevision:++structure,affected:[{type:'task',id:t.id,revision:++t.revision}]};}
        else throw Error(`Unexpected write ${url}`);
        receipts.set(body.operationId,result);return result;
    }});
    board.init();const select=id=>board.setProjects({projects:[{id,lifecycle:'active'}],selectedProjectId:id});select('p');await tick();
    return {respond:fn=>responder=fn,board,win,doc,elements,writes,events,tasks,sections,select,fail:v=>fail=v,malformed:v=>malformed=v,actor:v=>actor=v,role:v=>role=v,hold(){let r;hold=new Promise(resolve=>r=resolve);return r;},key:(el,key,extra={})=>el.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra})),close(){board.disposePresentation();win.close();}};
}
test('initial title uses one canonical POST; trims and validates server 200-character limit',async()=>{
    const h=await fixture();try{for(const title of ['', '   ', 'x'.repeat(201)])assert.equal(await h.board.createTask(null,'s',{initialTitle:title}),undefined);
        assert.equal(h.writes.length,0);const task=await h.board.createTask(null,'s',{initialTitle:'  Nguyễn <b>  '});assert.equal(task.title,'Nguyễn <b>');assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.title,'Nguyễn <b>');
        assert.equal((await h.board.createTask(null,'s',{initialTitle:'x'.repeat(200)})).title.length,200);
    }finally{h.close();}
});
test('composer owns Enter and touch submit once, IME ignored, rapid entry retains focus',async()=>{
    const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]');assert.ok(form);const input=form.querySelector('input');input.value='Một';h.key(input,'Enter',{isComposing:true});assert.equal(h.writes.length,0);
        const release=h.hold();h.key(input,'Enter');form.dispatchEvent(new h.win.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(h.writes.length,1);assert.equal([...h.board.getState().tasks.values()].filter(t=>t.isOptimistic).length,1);release();await tick();assert.equal(input.value,'');assert.equal(h.doc.activeElement,input);
        input.value='Hai';form.querySelector('[type="submit"]').click();await tick();assert.equal(h.writes.length,2);assert.equal(h.writes[1].body.title,'Hai');
    }finally{h.close();}
});
test('explicit sections and nested parent resolve without synthetic targets',async()=>{
    const h=await fixture();try{assert.equal(await h.board.createTask(null,'status:done',{initialTitle:'Bad'}),undefined);const task=await h.board.createTask('child','z',{initialTitle:'Deep'});assert.equal(task.parentTaskId,'child');assert.equal(h.writes.at(-1).body.sectionId,'s');assert.equal(h.writes.length,1);}finally{h.close();}
});
test('failed and uncertain composer retains text and retries the original immutable request',async()=>{
    const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]');assert.ok(form);const input=form.querySelector('input');input.value='Không mất';h.malformed(true);h.key(input,'Enter');await tick();assert.equal(input.value,'Không mất');assert.match(form.textContent,/unknown|unconfirmed|uncertain/i);const body=h.writes[0].body;h.malformed(false);form.querySelector('[type="submit"]').click();await tick();assert.deepEqual(h.writes[1].body,body);assert.equal(input.value,'');assert.equal(h.board.getState().tasks.has('new1'),true);}finally{h.close();}
});
test('V2 batch uses supported revision commands and removes only successful selection',async()=>{
    const h=await fixture();try{h.board.setSelectedTaskIds(['t','u']);const select=h.doc.getElementById('projects-batch-status');select.value='done';select.dispatchEvent(new h.win.Event('change',{bubbles:true}));await tick();assert.equal(h.writes.length,2);assert.equal(h.writes[0].body.changes[0].expectedRevision,1);assert.equal(h.board.getState().selectedTaskIds.length,0);assert.match(h.doc.querySelector('[data-batch-result]').textContent,/2 saved/);}finally{h.close();}
});
module.exports={fixture,tick};

test('remediation: persisted move acknowledgement reconciles nested hierarchy before saved',async()=>{
 const h=await fixture();try{
  h.tasks.push({id:'grand',title:'Grandchild',parentTaskId:'child',effectiveSectionId:'s',ancestorIds:['t','child'],pathIds:['grand','child','t'],revision:1,rank:'0/1'});await h.board.refresh();
  h.board.setSelectedTaskIds(['t']);const el=h.doc.getElementById('projects-batch-section');el.value='z';el.dispatchEvent(new h.win.Event('change'));await tick();
  for(const id of ['t','child','grand'])assert.equal(h.board.getState().tasks.get(id).effectiveSectionId,'z',id);
  assert.deepEqual(Array.from(h.board.getState().tasks.get('grand').ancestorIds),['t','child']);
  assert.match(h.doc.querySelector('[data-batch-result]').textContent,/1 saved/);
  await h.board.createTask('grand',null,{initialTitle:'After move'});assert.equal(h.writes.at(-1).body.sectionId,'z');
 }finally{h.close();}
});
test('empty project guides first task through section creation and resumes the task composer',async()=>{
    const h=await fixture();try{
        h.sections.splice(0);await h.board.refresh();
        h.doc.getElementById('btn-projects-board-add-task').click();
        assert.equal(h.elements.projectsBoardSectionForm.hidden,false);
        assert.match(h.elements.projectsBoardStatus.textContent,/first section/i);
        h.elements.projectsBoardSectionName.value='To do';
        h.elements.projectsBoardSectionForm.requestSubmit();await tick();
        const form=h.doc.querySelector('[data-quick-create]');assert.ok(form);
        assert.equal(form.querySelector('select').value,'sec1');
        assert.equal(h.writes.length,1);assert.match(h.writes[0].url,/\/sections$/);
        form.querySelector('input').value='First task';form.requestSubmit();await tick();
        assert.equal(h.writes.length,2);assert.match(h.writes[1].url,/\/tasks$/);assert.equal(h.writes[1].body.sectionId,'sec1');
    }finally{h.close();}
});
test('legacy empty project creates its default task only after a real first section',async()=>{
    const h=await fixture(false);try{
        h.sections.splice(0);await h.board.refresh();
        h.doc.getElementById('btn-projects-board-add-task').click();
        assert.equal(h.elements.projectsBoardSectionForm.hidden,false);assert.equal(h.writes.length,0);
        h.elements.projectsBoardSectionName.value='To do';h.elements.projectsBoardSectionForm.requestSubmit();await tick();
        assert.equal(h.writes.length,2);assert.match(h.writes[0].url,/\/sections$/);assert.match(h.writes[1].url,/\/tasks$/);
        assert.equal(h.writes[1].body.sectionId,'sec1');assert.equal(h.writes[1].body.title,'New task');
    }finally{h.close();}
});
test('remediation: flag-off uncertain create exposes exact-operation recovery',async()=>{
 const h=await fixture(false);try{
  h.malformed(true);h.doc.getElementById('btn-projects-board-add-task').click();await tick();
  const body=h.writes[0].body,retry=h.doc.querySelector('[data-retry-creation]');assert.ok(retry,'legacy recovery is reachable');
  h.doc.getElementById('btn-projects-board-add-task').click();await tick();assert.equal(h.writes.length,1);
  h.malformed(false);retry.click();await tick();assert.deepEqual(h.writes[1].body,body);
  assert.equal(h.tasks.filter(t=>t.title==='New task').length,1);assert.equal(h.doc.querySelector('[data-retry-creation]'),null);
 }finally{h.close();}
});
test('remediation: temporary parent settlement migrates mounted and retained composer draft',async()=>{
 const h=await fixture();try{
  const release=h.hold(),pending=h.board.createTask(null,'s',{initialTitle:'Draft parent'});await tick();
  const temp=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic);
  h.doc.querySelector(`[data-task-id="${temp.id}"] [data-action="add-subtask"]`).click();
  const input=h.doc.querySelector('[data-quick-create] input');input.value='Retained child';input.dispatchEvent(new h.win.Event('input'));input.focus();
  release();const parent=await pending;await tick();assert.equal(h.doc.activeElement,input);
  h.doc.querySelector('[data-cancel-create]').click();h.doc.querySelector(`[data-task-id="${parent.id}"] [data-action="add-subtask"]`).click();
  assert.equal(h.doc.querySelector('[data-quick-create] input').value,'Retained child');
  h.doc.querySelector('[data-quick-create]').requestSubmit();await tick();assert.equal(h.writes.at(-1).body.parentTaskId,parent.id);assert.equal(h.writes.at(-1).body.sectionId,'s');
 }finally{h.close();}
});
for(const order of [['t','child'],['child','t']]) test(`remediation: batch move ordering ${order.join(',')} preserves counts and ancestry`,async()=>{
 const h=await fixture();try{
  h.tasks.push({id:'grand',parentTaskId:'child',effectiveSectionId:'s',ancestorIds:['t','child'],revision:1,rank:'0/1'});await h.board.refresh();
  h.board.setSelectedTaskIds(order);const el=h.doc.getElementById('projects-batch-section');el.value='z';el.dispatchEvent(new h.win.Event('change'));await tick();
  assert.deepEqual(h.writes.map(w=>w.body.expectedStructureRevision),[1,2]);
  assert.equal(h.board.getState().tasks.get('t').activeChildCount,0);
  assert.deepEqual(Array.from(h.board.getState().tasks.get('child').ancestorIds),[]);
  assert.deepEqual(Array.from(h.board.getState().tasks.get('grand').ancestorIds),['child']);
  assert.equal(h.board.getState().tasks.get('grand').effectiveSectionId,'z');
  assert.match(h.doc.querySelector('[data-batch-result]').textContent,/2 saved/);
 }finally{h.close();}
});
test('remediation: partial move failure leaves remaining hierarchy and ordered selection intact',async()=>{
 const h=await fixture();try{
  h.respond((url)=>{if(url.endsWith('/child/move'))throw Object.assign(Error('Denied'),{status:403});});
  h.board.setSelectedTaskIds(['t','child','u']);const el=h.doc.getElementById('projects-batch-section');el.value='z';el.dispatchEvent(new h.win.Event('change'));await tick();
  assert.equal(h.board.getState().tasks.get('child').parentTaskId,'t');assert.equal(h.board.getState().tasks.get('child').effectiveSectionId,'z');
  assert.equal(h.board.getState().tasks.get('t').activeChildCount,1);assert.equal(h.writes.length,2);
  assert.deepEqual(Array.from(h.board.getState().selectedTaskIds),['child','u']);assert.match(h.doc.querySelector('[data-batch-result]').textContent,/1 saved.*1 failed.*1 waiting/);
 }finally{h.close();}
});
for(const loss of ['actor','project','role']) test(`remediation: move reconciliation is fenced by ${loss}`,async()=>{
 const h=await fixture();try{
  const release=h.hold();h.board.setSelectedTaskIds(['t','child']);const el=h.doc.getElementById('projects-batch-section');el.value='z';el.dispatchEvent(new h.win.Event('change'));await tick();
  if(loss==='actor')h.actor('b');if(loss==='project')h.select('q');if(loss==='role'){h.role('Viewer');await h.board.refresh();}
  release();await tick();assert.equal(h.writes.length,1);assert.doesNotMatch(h.doc.querySelector('[data-batch-result]')?.textContent||'',/1 saved/);
  assert.notEqual(h.board.getState().tasks.get('child')?.effectiveSectionId,'z');
 }finally{h.close();}
});
test('remediation: legacy replay recovers an already persisted create without duplicates',async()=>{
 const h=await fixture(false);try{
  let payload,ack;
  h.respond((url,body)=>{if(!ack){payload=body;const task={...body,id:'confirmed',revision:1,rank:'2/1'};h.tasks.push(task);ack={task,structureRevision:2};return {ok:true};}assert.deepEqual(body,payload);return ack;});
  await h.board.createTask(null,'s');const retry=h.doc.querySelector('[data-retry-creation]');assert.ok(retry);
  const release=h.hold();retry.click();retry.click();await tick();assert.equal(h.writes.length,2);release();await tick();
  assert.equal(h.tasks.filter(t=>t.id==='confirmed').length,1);assert.equal(h.board.getState().tasks.has('confirmed'),true);
 }finally{h.close();}
});
for(const loss of ['actor','project','role','dispose']) test(`remediation: detached legacy retry cannot escape ${loss} fencing`,async()=>{
 const h=await fixture(false);try{
  h.malformed(true);await h.board.createTask(null,'s');const retry=h.doc.querySelector('[data-retry-creation]');assert.ok(retry);
  if(loss==='actor')h.actor('b');if(loss==='project')h.select('q');if(loss==='role'){h.role('Viewer');await h.board.refresh();}if(loss==='dispose')h.board.disposePresentation();
  h.malformed(false);retry.click();await tick();assert.equal(h.writes.length,1);
 }finally{h.close();}
});
test('remediation: nested optimistic composer targets migrate without remount or intent replacement',async()=>{
 const h=await fixture();try{
  const release=h.hold(),p=h.board.createTask(null,'s',{initialTitle:'P'});await tick();const tempP=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic).id;
  const c=h.board.createTask(tempP,null,{initialTitle:'C'});await tick();const tempC=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic&&t.id!==tempP).id;
  h.doc.querySelector(`[data-task-id="${tempC}"] [data-action="add-subtask"]`).click();const form=h.doc.querySelector('[data-quick-create]'),input=form.querySelector('input');input.value='Grand draft';input.dispatchEvent(new h.win.Event('input'));
  release();const [parent,child]=await Promise.all([p,c]);await tick();assert.equal(h.doc.querySelector('[data-quick-create]'),form);assert.equal(h.doc.activeElement,input);
  h.malformed(true);form.requestSubmit();await tick();const request=h.writes.at(-1).body;assert.equal(request.parentTaskId,child.id);assert.equal(request.sectionId,'s');
  h.doc.querySelector(`[data-task-id="${parent.id}"] [data-action="add-subtask"]`).click();h.doc.querySelector(`[data-task-id="${child.id}"] [data-action="add-subtask"]`).click();
  assert.equal(h.doc.querySelector('[data-quick-create] input').value,'Grand draft');h.malformed(false);h.doc.querySelector('[data-quick-create]').requestSubmit();await tick();assert.deepEqual(h.writes.at(-1).body,request);
 }finally{h.close();}
});
test('remediation: parent uncertain retry migrates drafts from its previous temporary identity',async()=>{
 const h=await fixture();try{
  const release=h.hold();h.malformed(true);const p=h.board.createTask(null,'s',{initialTitle:'P',intentId:'parent-op'});await tick();const temp=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic).id;
  h.doc.querySelector(`[data-task-id="${temp}"] [data-action="add-subtask"]`).click();const input=h.doc.querySelector('[data-quick-create] input');input.value='Recovery child';input.dispatchEvent(new h.win.Event('input'));
  release();await p;assert.equal(h.doc.querySelector('[data-quick-create] input').value,'Recovery child');
  h.malformed(false);const parent=await h.board.createTask(null,'s',{initialTitle:'P',intentId:'parent-op'});h.doc.querySelector('[data-cancel-create]').click();h.doc.querySelector(`[data-task-id="${parent.id}"] [data-action="add-subtask"]`).click();assert.equal(h.doc.querySelector('[data-quick-create] input').value,'Recovery child');
 }finally{h.close();}
});
test('remediation: submitted composer reopened after parent migration settles its live controls',async()=>{
 const h=await fixture();try{
  const release=h.hold(),p=h.board.createTask(null,'s',{initialTitle:'P'});await tick();const temp=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic).id;
  h.doc.querySelector(`[data-task-id="${temp}"] [data-action="add-subtask"]`).click();let input=h.doc.querySelector('[data-quick-create] input');input.value='C';h.doc.querySelector('[data-quick-create]').requestSubmit();
  h.doc.querySelector('[data-task-id="t"] [data-action="add-subtask"]').click();const releaseChild=h.hold();release();const parent=await p;await tick();
  h.doc.querySelector(`[data-task-id="${parent.id}"] [data-action="add-subtask"]`).click();input=h.doc.querySelector('[data-quick-create] input');assert.equal(input.value,'C');assert.equal(input.readOnly,true);
  releaseChild();await tick();assert.equal(input.value,'');assert.equal(input.readOnly,false);assert.match(h.doc.querySelector('[data-quick-create]').textContent,/Saved/);
 }finally{h.close();}
});
test('remediation: unknown legacy operation remains recoverable when parent leaves loaded query',async()=>{
 const h=await fixture(false);try{
  h.malformed(true);await h.board.createTask('t','s');const payload=h.writes[0].body;h.tasks.splice(0,h.tasks.length);await h.board.refresh();
  h.respond((url,body)=>{assert.deepEqual(body,payload);return {task:{...body,id:'replayed',revision:1},structureRevision:2};});h.malformed(false);
  h.doc.querySelector('[data-retry-creation]').click();await tick();assert.equal(h.writes.length,2);assert.equal(h.board.getState().tasks.has('replayed'),true);
 }finally{h.close();}
});

for(const failure of [403,409,-1]) test(`task failure ${failure} retains text; transport retries preserve identity`,async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]'),input=form.querySelector('input');input.value='Giữ bản nháp';h.fail(failure);h.key(input,'Enter');await new Promise(r=>setTimeout(r,230));await tick();assert.equal(input.value,'Giữ bản nháp');assert.equal([...h.board.getState().tasks.values()].some(t=>t.isOptimistic),false);assert.equal(h.writes.length,failure<0?2:1);if(failure<0)assert.deepEqual(h.writes[0].body,h.writes[1].body);h.fail(0);form.querySelector('[type="submit"]').click();await tick();assert.equal(input.value,'');}finally{h.close();}
});
for(const loss of ['actor','project','role']) test(`late create and detached composer are fenced by ${loss}`,async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]'),input=form.querySelector('input');input.value='Private';const release=h.hold();h.key(input,'Enter');await tick();if(loss==='actor')h.actor('other');if(loss==='project')h.select('q');if(loss==='role'){h.role('Viewer');await h.board.refresh();}release();await tick();form.dispatchEvent(new h.win.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(h.writes.length,1);assert.equal(h.doc.querySelector('[data-quick-create]'),null);assert.equal(h.events.some(e=>e.phase==='saved'),false);}finally{h.close();}
});
test('optimistic parent and child settle ancestry and selection without duplicate rows',async()=>{
 const h=await fixture();try{const release=h.hold();const parent=h.board.createTask(null,'s',{initialTitle:'Parent new'});await tick();const temp=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic);h.board.setSelectedTaskIds([temp.id]);const child=h.board.createTask(temp.id,null,{initialTitle:'Child new'});release();const [p,c]=await Promise.all([parent,child]);assert.equal(c.parentTaskId,p.id);assert.deepEqual(h.writes.map(w=>w.body.expectedStructureRevision),[1,2]);assert.equal([...h.board.getState().tasks.values()].filter(t=>t.isOptimistic).length,0);assert.deepEqual(Array.from(h.board.getState().selectedTaskIds),[p.id]);}finally{h.close();}
});
test('failed parent prevents orphan dispatch and cleans pending child',async()=>{
 const h=await fixture();try{const release=h.hold();h.fail(403);const parent=h.board.createTask(null,'s',{initialTitle:'P'});await tick();const id=[...h.board.getState().tasks.values()].find(t=>t.isOptimistic).id;const child=h.board.createTask(id,null,{initialTitle:'C'});release();await Promise.all([parent,child]);assert.equal(h.writes.length,1);assert.equal([...h.board.getState().tasks.values()].filter(t=>t.isOptimistic).length,0);}finally{h.close();}
});
test('composer acknowledgement never steals external focus',async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]'),input=form.querySelector('input');input.value='Title';const release=h.hold();h.key(input,'Enter');const elsewhere=h.doc.createElement('button');h.doc.body.append(elsewhere);elsewhere.focus();release();await tick();assert.equal(h.doc.activeElement,elsewhere);}finally{h.close();}
});
test('section failure keeps named form, pending guard and exact uncertain retry',async()=>{
 const h=await fixture();try{h.elements.projectsBoardAddSection.click();h.elements.projectsBoardSectionName.value='Nhóm mới';const release=h.hold();h.malformed(true);h.elements.projectsBoardSectionForm.requestSubmit();h.elements.projectsBoardSectionForm.requestSubmit();await tick();assert.equal(h.writes.length,1);release();await tick();assert.equal(h.elements.projectsBoardSectionName.value,'Nhóm mới');assert.equal(h.elements.projectsBoardSectionForm.hidden,false);const body=h.writes[0].body;h.malformed(false);h.elements.projectsBoardSectionForm.requestSubmit();await tick();assert.deepEqual(h.writes[1].body,body);assert.equal(h.elements.projectsBoardSectionForm.hidden,true);}finally{h.close();}
});
test('partial status batch is deterministic and retains failed selection only',async()=>{
 const h=await fixture();try{h.respond((url,body)=>{if(body.changes?.[0].taskId==='u')throw Object.assign(Error('Changed'),{status:409});});h.board.setSelectedTaskIds(['t','u','child']);const el=h.doc.getElementById('projects-batch-status');el.value='done';el.dispatchEvent(new h.win.Event('change'));await tick();assert.deepEqual(h.writes.map(w=>w.body.changes[0].taskId),['t','u','child']);assert.deepEqual(Array.from(h.board.getState().selectedTaskIds),['u']);assert.match(h.doc.querySelector('[data-batch-result]').textContent,/2 saved.*1 conflicts/);}finally{h.close();}
});
test('uncertain structural batch stops chain and retries identical request before continuing',async()=>{
 const h=await fixture();try{h.board.setSelectedTaskIds(['t','u']);h.malformed(true);const el=h.doc.getElementById('projects-batch-section');el.value='z';el.dispatchEvent(new h.win.Event('change'));await tick();assert.equal(h.writes.length,1);assert.match(h.doc.querySelector('[data-batch-result]').textContent,/1 unconfirmed.*1 waiting/);h.malformed(false);h.doc.querySelector('[data-batch-result] button').click();await tick();assert.deepEqual(h.writes[0].body,h.writes[1].body);assert.equal(h.writes[2].body.expectedStructureRevision,2);assert.equal(h.board.getState().selectedTaskIds.length,0);}finally{h.close();}
});
test('archive uses lifecycle endpoint with revisions, not bulk patch; no invented Undo',async()=>{
 const h=await fixture();try{h.win.confirm=()=>true;h.board.setSelectedTaskIds(['t','child']);h.doc.getElementById('btn-projects-batch-delete').click();await tick();assert.equal(h.writes.length,1);assert.match(h.writes[0].url,/tasks\/t\/archive$/);assert.equal(h.writes[0].body.expectedRevision,1);assert.equal(h.writes[0].body.expectedStructureRevision,1);assert.equal(h.board.getState().tasks.has('child'),false);assert.equal(h.doc.querySelector('[data-batch-result] [data-undo]'),null);}finally{h.close();}
});
test('legacy create remains immediate and defaults to New task',async()=>{
 const h=await fixture(false);try{h.doc.getElementById('btn-projects-board-add-task').click();await tick();assert.equal(h.doc.querySelector('[data-quick-create]'),null);assert.equal(h.writes[0].body.title,'New task');}finally{h.close();}
});

test('switching composer targets during a delayed success does not resurrect a submitted draft',async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const input=h.doc.querySelector('[data-quick-create] input');input.value='Only once';const release=h.hold();h.key(input,'Enter');await tick();h.doc.querySelector('[data-task-id="t"] [data-action="add-subtask"]').click();release();await tick();h.doc.getElementById('btn-projects-board-add-task').click();assert.equal(h.doc.querySelector('[data-quick-create] input').value,'');assert.equal(h.writes.length,1);}finally{h.close();}
});
test('task then section creates share a serialized structure revision chain',async()=>{
 const h=await fixture();try{const release=h.hold();const task=h.board.createTask(null,'s',{initialTitle:'T'});await tick();h.elements.projectsBoardAddSection.click();h.elements.projectsBoardSectionName.value='S';const section=h.board.createSection();await tick();assert.equal(h.writes.length,1,'section waits for preceding create');release();await Promise.all([task,section]);assert.deepEqual(h.writes.map(w=>w.body.expectedStructureRevision),[1,2]);}finally{h.close();}
});
test('synthetic grouping requires explicit real section and Escape cancels without mutation',async()=>{
 const h=await fixture();try{const group=h.doc.getElementById('projects-board-group-by');group.value='status';group.dispatchEvent(new h.win.Event('change'));h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]');assert.equal(form.querySelector('select').value,'');const input=form.querySelector('input');input.value='Draft';h.key(input,'Enter');await tick();assert.equal(h.writes.length,0);h.key(input,'Escape');assert.equal(h.doc.querySelector('[data-quick-create]'),null);}finally{h.close();}
});
for(const loss of ['actor','project','role']) test(`batch acknowledgements and continuation are fenced after ${loss} change`,async()=>{
 const h=await fixture();try{h.board.setSelectedTaskIds(['t','u']);const release=h.hold();const el=h.doc.getElementById('projects-batch-status');el.value='done';el.dispatchEvent(new h.win.Event('change'));await tick();if(loss==='actor')h.actor('b');if(loss==='project')h.select('q');if(loss==='role'){h.role('Viewer');await h.board.refresh();}release();await tick();assert.equal(h.writes.length,1);assert.doesNotMatch(h.doc.querySelector('[data-batch-result]')?.textContent||'',/1 saved/);}finally{h.close();}
});

test('each real section footer opens its composer, including empty sections, after its rows',async()=>{
 const h=await fixture();try{const footers=[...h.doc.querySelectorAll('[data-action="quick-task"]')];assert.equal(footers.length,2);footers[1].click();assert.equal(h.doc.querySelector('[data-quick-create] select').value,'z');assert.ok(h.elements.projectsBoardTableWrap.compareDocumentPosition(h.elements.projectsBoardAddSection)&h.win.Node.DOCUMENT_POSITION_FOLLOWING);}finally{h.close();}
});
test('canonical section insertion index is independent of synthetic grouping',async()=>{
 const h=await fixture();try{const group=h.doc.getElementById('projects-board-group-by');group.value='status';group.dispatchEvent(new h.win.Event('change'));await h.board.createTask(null,'s',{initialTitle:'Indexed'});assert.equal(h.writes[0].body.index,2);}finally{h.close();}
});

test('scope switch during transport retry delay prevents dispatch to the former project',async()=>{
 const h=await fixture();try{h.fail(-1);const pending=h.board.createTask(null,'s',{initialTitle:'Old project'});await tick();h.select('q');await pending;assert.equal(h.writes.length,1);}finally{h.close();}
});
test('reopening the same pending composer settles its mounted controls and scopes drafts by section',async()=>{
 const h=await fixture();try{h.doc.querySelector('[data-section-id="s"] [data-action="quick-task"]').click();let input=h.doc.querySelector('[data-quick-create] input');input.value='Pending';const release=h.hold();h.key(input,'Enter');await tick();h.doc.querySelector('[data-section-id="z"] [data-action="quick-task"]').click();h.doc.querySelector('[data-section-id="s"] [data-action="quick-task"]').click();release();await tick();input=h.doc.querySelector('[data-quick-create] input');assert.equal(input.value,'');assert.equal(input.readOnly,false);const target=h.doc.querySelector('[data-quick-create] select');target.value='z';target.dispatchEvent(new h.win.Event('change'));input=h.doc.querySelector('[data-quick-create] input');input.value='Z draft';input.dispatchEvent(new h.win.Event('input'));h.doc.querySelector('[data-quick-create] [data-cancel-create]').click();h.doc.querySelector('[data-section-id="s"] [data-action="quick-task"]').click();assert.equal(h.doc.querySelector('[data-quick-create] input').value,'');h.doc.querySelector('[data-section-id="z"] [data-action="quick-task"]').click();assert.equal(h.doc.querySelector('[data-quick-create] input').value,'Z draft');}finally{h.close();}
});

test('delayed batch acknowledgement preserves a newer canonical remote task',async()=>{
 const h=await fixture();try{h.board.setSelectedTaskIds(['t']);const release=h.hold();const el=h.doc.getElementById('projects-batch-status');el.value='done';el.dispatchEvent(new h.win.Event('change'));await tick();h.board.updateTask({...h.board.getState().tasks.get('t'),status:'blocked',title:'Remote title',revision:4});release();await tick();assert.equal(h.board.getState().tasks.get('t').status,'blocked');assert.equal(h.board.getState().tasks.get('t').revision,4);assert.equal(h.board.getState().tasks.get('t').title,'Remote title');}finally{h.close();}
});
test('native submit during IME composition cannot create',async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]'),input=form.querySelector('input');input.value='Tiếng Việt';input.dispatchEvent(new h.win.CompositionEvent('compositionstart',{bubbles:true}));form.requestSubmit();await tick();assert.equal(h.writes.length,0);input.dispatchEvent(new h.win.CompositionEvent('compositionend',{bubbles:true}));form.requestSubmit();await tick();assert.equal(h.writes.length,1);}finally{h.close();}
});

test('Escape returns focus to the creation trigger and failed batch selector can repeat its action',async()=>{
 const h=await fixture();try{const trigger=h.doc.getElementById('btn-projects-board-add-task');trigger.focus();trigger.click();h.key(h.doc.querySelector('[data-quick-create] input'),'Escape');assert.equal(h.doc.activeElement,trigger);h.board.setSelectedTaskIds(['t']);h.fail(409);const el=h.doc.getElementById('projects-batch-status');el.value='done';el.dispatchEvent(new h.win.Event('change'));await tick();assert.equal(el.value,'');}finally{h.close();}
});

test('disposed composer controls cannot submit a new task',async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const form=h.doc.querySelector('[data-quick-create]');form.querySelector('input').value='Detached';h.board.disposePresentation();form.dispatchEvent(new h.win.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(h.writes.length,0);}finally{h.close();}
});

test('focus deliberately moved onto an optimistic row transfers to its canonical row',async()=>{
 const h=await fixture();try{h.doc.getElementById('btn-projects-board-add-task').click();const input=h.doc.querySelector('[data-quick-create] input');input.value='Focused temporary task';const release=h.hold();h.key(input,'Enter');await tick();const row=h.doc.querySelector('[data-task-id^="opt-task-"]');assert.ok(row);row.focus();release();await tick();assert.equal(h.doc.activeElement.closest('[data-task-id]')?.dataset.taskId,'new1');assert.equal(h.doc.querySelectorAll('[data-task-id="new1"]').length,1);}finally{h.close();}
});

for (const v2 of [false, true]) test(`empty first-task permissions never queue Editor or Viewer work (V2=${v2})`, async () => {
 const h=await fixture(v2);try {
  h.sections.splice(0);h.tasks.splice(0);h.role('Editor');await h.board.refresh();
  h.doc.getElementById('btn-projects-board-add-task').click();
  assert.match(h.elements.projectsBoardStatus.textContent,/Owner.*first section/);
  assert.equal(h.elements.projectsBoardSectionForm.hidden,true);assert.equal(h.doc.querySelector('[data-quick-create]'),null);assert.equal(h.writes.length,0);
  h.role('Owner');await h.board.refresh();h.elements.projectsBoardAddSection.click();h.elements.projectsBoardSectionName.value='Independent';h.elements.projectsBoardSectionForm.requestSubmit();await tick();
  assert.equal(h.writes.length,1);assert.equal(h.doc.querySelector('[data-quick-create]'),null);
  h.sections.splice(0);h.role('Viewer');await h.board.refresh();
  const trigger=h.doc.getElementById('btn-projects-board-add-task');assert.equal(trigger.disabled,true);trigger.click();await tick();
  assert.equal(h.elements.projectsBoardSectionForm.hidden,true);assert.equal(h.writes.length,1);
 }finally{h.close();}
});
test('first section cancel drops the deferred task, and a failed retry opens exactly one canonical composer',async()=>{
 const h=await fixture();try {
  h.sections.splice(0);await h.board.refresh();const trigger=h.doc.getElementById('btn-projects-board-add-task');trigger.click();h.elements.projectsBoardCancelSection.click();
  h.elements.projectsBoardAddSection.click();h.elements.projectsBoardSectionName.value='Cancelled task';h.elements.projectsBoardSectionForm.requestSubmit();await tick();assert.equal(h.doc.querySelector('[data-quick-create]'),null);
  h.sections.splice(0);await h.board.refresh();trigger.click();trigger.click();h.fail(409);h.elements.projectsBoardSectionName.value='Retry';h.elements.projectsBoardSectionForm.requestSubmit();await tick();
  assert.equal(h.doc.querySelector('[data-quick-create]'),null);h.fail(0);h.elements.projectsBoardSectionForm.requestSubmit();await tick();
  assert.equal(h.doc.querySelectorAll('[data-quick-create]').length,1);assert.equal(h.doc.querySelector('[data-quick-create] select').value,'sec2');assert.equal(h.writes.filter(w=>w.url.endsWith('/tasks')).length,0);
 }finally{h.close();}
});
for(const change of ['role','project','actor']) test(`first-section acknowledgement cannot resume after ${change} changes`,async()=>{
 const h=await fixture();try {
  h.sections.splice(0);await h.board.refresh();h.doc.getElementById('btn-projects-board-add-task').click();h.elements.projectsBoardSectionName.value='Old intent';const release=h.hold();h.elements.projectsBoardSectionForm.requestSubmit();await tick();
  if(change==='role'){h.role('Editor');await h.board.refresh();}else if(change==='actor')h.actor('b');else h.select('q');
  release();await tick();assert.equal(h.doc.querySelector('[data-quick-create]'),null);assert.equal(h.writes.filter(w=>w.url.endsWith('/tasks')).length,0);
  if(change==='role'){h.role('Owner');await h.board.refresh();h.elements.projectsBoardAddSection.click();h.elements.projectsBoardSectionName.value='New intent';h.elements.projectsBoardSectionForm.requestSubmit();await tick();assert.equal(h.doc.querySelector('[data-quick-create]'),null);}
 }finally{h.close();}
});
