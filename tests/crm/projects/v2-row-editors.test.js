'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for (let i=0;i<16;i++) await new Promise(setImmediate); };
async function fixture(v2 = true) {
    const dom = new JSDOM(fs.readFileSync(path.join(root,'public/crm-admin.html'),'utf8'), {runScripts:'outside-only',url:'https://fixture.invalid',pretendToBeVisual:true});
    const win=dom.window, doc=win.document;
    for(const name of ['presentation/column-model','presentation/table-layout','presentation/field-feedback','state','board','date-picker']) win.eval(fs.readFileSync(path.join(root,`public/js/crm/projects/${name}.js`),'utf8'));
    win.CrmProjectsDatePicker.init();
    doc.querySelector('[data-panel="projects"]').setAttribute('data-projects-ui',v2?'v2':'legacy');
    const admin=fs.readFileSync(path.join(root,'public/crm-admin.js'),'utf8');
    const elements=Object.fromEntries([...admin.matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m=>[m[1],doc.getElementById(m[2])]));
    let actor='a',role='Owner',fail=0,malformed=false,hold=null,readHold=null,branchResponder=null,previewWarnings=[],previewAllowed=true,refreshResult=false;
    const columns=[{id:'notes',label:'Notes',type:'text'},{id:'estimate',label:'Estimate',type:'number'},{id:'deadline',label:'Deadline',type:'date'},{id:'importance',label:'Priority',type:'priority'},{id:'phase',label:'Phase',type:'status',statusLabels:{done:'Finished'}},{id:'choice',label:'Choice',type:'dropdown',options:[{key:'yes',label:'Yes'}]},{id:'team',label:'Team',type:'people'},{id:'future',type:'future'}];
    let task={id:'t',sectionId:'s',title:'Tiếng Việt <img src=x>',status:'not_started',rank:'0/1',revision:1,activeChildCount:0,ownerUid:'a',assigneeUids:['b','former'],startDate:'2026-09-01',dueDate:'2026-09-20',values:{notes:'Stored',estimate:0,importance:'high',phase:'done',choice:'removed',team:['former'],future:{safe:'<script>'}}};
    const tasks=Array.from({length:70},(_,i)=>({...task,id:i?`t${i}`:'t',rank:`${i}/1`}));
    const writes=[],events=[];
    const board=win.CrmProjectsBoard.createController({elements,presentationV2:v2,getCurrentUser:()=>({uid:actor}),onFieldSaveEvent:e=>events.push(e),refreshProjects:async()=>refreshResult,apiFetchJson:async(url,options)=>{
        if(options){const body=JSON.parse(options.body||'{}');writes.push({url,body}); if(hold){const wait=hold;hold=null;await wait;}
            if(fail)throw Object.assign(new Error('Fixture denied/conflict/unconfirmed'),fail===-1?{}:{status:fail});
            if(malformed)return {ok:true};
            if(url==='/api/projects')return {project:{id:'created-project'}};
            if(url.endsWith('/schedule-preview')){previewDates={startDate:body.startDate,dueDate:body.dueDate};return {preview:{token:'preview-token',canApply:previewAllowed,taskId:'t',after:{startDate:body.startDate,dueDate:body.dueDate},workingDayCount:12,warnings:previewWarnings}};}
            if(url.endsWith('/schedule-apply')){task={...task,...previewDates,revision:task.revision+1};tasks[0]=task;return {result:{task}};}
            task={...task,...body,values:{...task.values,...body.values},revision:task.revision+1};tasks[0]=task;return {task};}
        if(url.includes('member-directory'))return {people:[{uid:'a',displayName:'Owner A'},{uid:'b',displayName:'Collaborator B'},{uid:'c',displayName:'Nguyễn C'}]};
        if(url.includes('/tasks?'))return branchResponder ? branchResponder(url) : {tasks,columns,sections:[{id:'s',title:'Section',rank:'0/1'},{id:'s2',title:'Other',rank:'1/1'}],revision:{schemaRevision:1,structureRevision:1}};
        if(url.endsWith('/tasks/t')){if(readHold){const wait=readHold;readHold=null;await wait;}return {task};}
        return {project:{id:url.split('/').pop(),lifecycle:'active'},membership:{role}};
    }});
    let previewDates={startDate:'2026-09-02',dueDate:'2026-09-21'};
    board.init();const select=id=>board.setProjects({projects:[{id,lifecycle:'active'}],selectedProjectId:id});select('p');await tick();
    return {win,doc,board,elements,writes,events,columns,select,remote(patch){task={...task,...patch,revision:task.revision+1};tasks[0]=task;board.updateTask(task);},refreshResult:value=>{refreshResult=value;},preview:(warnings,allowed=true)=>{previewWarnings=warnings;previewAllowed=allowed;},branches:fn=>branchResponder=fn,row:()=>doc.querySelector('[data-task-id="t"]'),key:(el,key,extra={})=>el.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra})),change:el=>el.dispatchEvent(new win.Event('change',{bubbles:true})),input:el=>el.dispatchEvent(new win.Event('input',{bubbles:true})),actor:v=>actor=v,role:v=>role=v,fail:v=>fail=v,malformed:()=>malformed=true,holdRead(){let release;readHold=new Promise(r=>release=r);return release;},hold(){let release;hold=new Promise(r=>release=r);return release;},close(){board.disposePresentation();win.close();}};
}

for(const field of ['assigneeUids','team']) test(`remote ${field} assignments require review before successive selections`,async()=>{
    const h=await fixture();try{
        const custom=field==='team', patch=value=>custom?{values:{...h.board.getState().tasks.get('t').values,team:value}}:{assigneeUids:value};
        h.remote(patch(['b']));
        h.row().querySelector(custom?'[data-column-key="custom:team"] [data-people-kind]':'[data-people-kind="assigneeUids"]').click();
        h.remote(patch(['b','c']));
        let option=h.doc.querySelector('[data-people-uid="b"]');option.focus();option.click();await tick();
        assert.equal(h.writes.length,0,'stale selection must not dispatch a destructive replacement');
        assert.equal(h.doc.activeElement.dataset.peopleUid,'b');
        assert.match(h.doc.querySelector('[data-people-result]').textContent,/changed/i);
        h.doc.querySelector('[data-reload-people]').click();await tick();
        assert.equal(h.doc.querySelector('[data-people-uid="c"]').getAttribute('aria-selected'),'true');
        h.doc.querySelector('[data-people-uid="b"]').click();await tick();
        assert.deepEqual(custom?h.writes.at(-1).body.values.team:h.writes.at(-1).body.assigneeUids,['c']);
        assert.equal(h.writes.at(-1).body.expectedRevision,3);
        h.remote(patch(['c','former']));
        option=h.doc.querySelector('[data-people-uid="c"]');option.focus();option.click();await tick();assert.equal(h.writes.length,1);
        h.doc.querySelector('[data-reload-people]').click();await tick();h.doc.querySelector('[data-people-uid="c"]').click();await tick();
        assert.deepEqual(custom?h.writes.at(-1).body.values.team:h.writes.at(-1).body.assigneeUids,['former']);
        assert.equal(h.writes.at(-1).body.expectedRevision,5);
        assert.equal(h.doc.activeElement.dataset.peopleUid,'c');assert.equal(h.board.getState().tasks.get('t').ownerUid,'a');
    }finally{h.close();}
});

for(const stage of ['preview','apply']) test(`date ${stage} conflict can review and rebase retained newer input after reopen`,async()=>{
    const h=await fixture();try{
        const open=()=>{h.row().querySelector('[data-action="edit-dates"]').click();return h.doc.querySelector('[data-row-editor="dates"]');};
        let picker=open();let due=picker.querySelector('[name="dueDate"]');due.value='2026-09-22';h.input(due);
        if(stage==='apply'){picker.querySelector('[data-preview-dates]').click();await tick();}
        h.remote({dueDate:'2026-09-25'});h.fail(409);
        picker.querySelector(stage==='apply'?'[data-apply-dates]':'[data-preview-dates]').click();await tick();
        h.fail(0);h.key(picker,'Escape');await h.board.refresh();picker=open();
        assert.equal(picker.querySelector('[name="dueDate"]').value,'2026-09-22');
        assert.ok(picker.querySelector('[data-review-dates]'),'retained date draft needs an explicit recovery path');
        picker.querySelector('[data-review-dates]').click();await tick();
        assert.match(picker.querySelector('[data-date-result]').textContent,/2026-09-25/);
        due=picker.querySelector('[name="dueDate"]');due.value='2026-09-26';h.input(due);
        const writes=h.writes.length;picker.querySelector('[data-rebase-dates]').click();await tick();
        assert.equal(h.writes.length,writes,'review/rebase never applies a schedule');
        assert.equal(due.value,'2026-09-26');assert.equal(picker.querySelector('[data-apply-dates]').disabled,true);
        picker.querySelector('[data-preview-dates]').click();await tick();
        assert.equal(h.writes.at(-1).body.expectedRevision,2);assert.equal(h.writes.at(-1).body.dueDate,'2026-09-26');
        picker.querySelector('[data-apply-dates]').click();await tick();assert.equal(h.board.getState().tasks.get('t').dueDate,'2026-09-26');
        picker=open();due=picker.querySelector('[name="dueDate"]');due.value='2026-09-29';h.input(due);
        picker.querySelector('[data-review-dates]').click();await tick();picker.querySelector('[data-discard-dates]').click();
        assert.equal(due.value,'2026-09-26');assert.equal(picker.querySelector('[data-apply-dates]').disabled,true);
    }finally{h.close();}
});
for(const loss of ['actor','project','permission']) test(`recovery reads and detached controls are fenced after ${loss} changes`,async()=>{
    for(const editor of ['people','dates']){
        const h=await fixture();try{
            h.row().querySelector(editor==='people'?'[data-people-kind="assigneeUids"]':'[data-action="edit-dates"]').click();
            const node=h.doc.querySelector(editor==='people'?'.crm-people-popover':'[data-row-editor="dates"]');
            const release=h.holdRead();node.querySelector(editor==='people'?'[data-reload-people]':'[data-review-dates]').click();await tick();
            if(loss==='actor'){h.actor('other');h.row().querySelector('[data-action="task-menu"]').click();}
            if(loss==='project')h.select('q');
            if(loss==='permission'){h.role('Viewer');await h.board.refresh();}
            release();await tick();
            node.querySelector(editor==='people'?'[data-people-uid="c"]':'[data-rebase-dates]').click();
            if(editor==='dates')node.querySelector('[data-preview-dates]').click();await tick();
            assert.equal(node.isConnected,false);assert.equal(h.writes.length,0);
        }finally{h.close();}
    }
});

test('people selections preserve local queue lineage and retain remote changes arriving during a save',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-people-kind="assigneeUids"]').click();const release=h.hold();
        h.doc.querySelector('[data-people-uid="b"]').click();await tick();
        h.doc.querySelector('[data-people-uid="c"]').click();release();await tick();
        assert.deepEqual(h.writes.map(w=>w.body.expectedRevision),[1,2]);assert.deepEqual(h.writes[1].body.assigneeUids,['former','c']);
        const release2=h.hold();h.fail(409);h.doc.querySelector('[data-people-uid="b"]').click();await tick();
        h.remote({assigneeUids:['c','former','a-remote']});release2();await tick();h.fail(0);
        const count=h.writes.length;h.doc.querySelector('[data-people-uid="c"]').click();await tick();assert.equal(h.writes.length,count);
        h.doc.querySelector('[data-reload-people]').click();await tick();h.doc.querySelector('[data-people-uid="c"]').click();await tick();
        assert.deepEqual(h.writes.at(-1).body.assigneeUids,['former','a-remote']);
    }finally{h.close();}
});

test('date review invalidates a delayed obsolete preview and keeps later input through apply conflict',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();const node=h.doc.querySelector('[data-row-editor="dates"]');
        const due=node.querySelector('[name="dueDate"]');due.value='2026-09-22';h.input(due);
        const release=h.hold();node.querySelector('[data-preview-dates]').click();await tick();
        h.remote({dueDate:'2026-09-25'});node.querySelector('[data-review-dates]').click();await tick();
        node.querySelector('[data-rebase-dates]').click();release();await tick();
        assert.equal(node.querySelector('[data-apply-dates]').disabled,true,'obsolete preview cannot restore Apply');
        node.querySelector('[data-preview-dates]').click();await tick();assert.equal(h.writes.at(-1).body.expectedRevision,2);
        const applyRelease=h.hold();h.fail(409);node.querySelector('[data-apply-dates]').click();await tick();
        due.value='2026-09-27';h.input(due);h.remote({dueDate:'2026-09-26'});applyRelease();await tick();h.fail(0);
        assert.equal(due.value,'2026-09-27');assert.equal(node.querySelector('[data-apply-dates]').disabled,true);
        node.querySelector('[data-review-dates]').click();await tick();node.querySelector('[data-rebase-dates]').click();
        node.querySelector('[data-preview-dates]').click();await tick();assert.equal(h.writes.at(-1).body.expectedRevision,3);assert.equal(h.writes.at(-1).body.dueDate,'2026-09-27');
    }finally{h.close();}
});

test('V2 title opens once, selection is separate, F2 renames with IME/Enter/Escape and leaf chevron adds subtasks',async()=>{
    const h=await fixture();try{
        // A task without subtasks offers one quiet "add subtasks" chevron and never loads a branch.
        const row=h.row();const leaf=row.querySelector('.crm-board-expander.is-leaf');assert.ok(leaf);assert.equal(leaf.dataset.action,'toggle-task');assert.equal(leaf.getAttribute('aria-expanded'),'false');
        const title=row.querySelector('.crm-board-title-button');assert.ok(title);assert.equal(title.textContent,'Tiếng Việt <img src=x>');assert.equal(title.querySelector('img'),null);
        row.querySelector('[data-action="select-task"]').click();assert.equal(h.board.getState().selectedTaskId,'');
        h.row().querySelector('.crm-board-title-button').click();assert.equal(h.board.getState().selectedTaskId,'t');
        assert.equal(h.doc.querySelector('[data-detail-panel="details"]').hidden,false);
        h.key(h.row(),'F2');let editor=h.row().querySelector('input[data-field-kind="title"]');assert.equal(h.doc.activeElement,editor);
        editor.value='Đổi tên';h.input(editor);h.key(editor,'Enter',{isComposing:true});await tick();assert.equal(h.writes.length,0);
        h.key(editor,'Enter');await tick();assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.title,'Đổi tên');assert.equal(h.row().querySelector('.crm-board-title-button').textContent,'Đổi tên');
        h.key(h.row(),'F2');editor=h.row().querySelector('input[data-field-kind="title"]');editor.value='Cancel me';h.input(editor);h.key(editor,'Escape');await tick();assert.equal(h.writes.length,1);assert.equal(h.row().querySelector('.crm-board-title-button').textContent,'Đổi tên');
        assert.doesNotMatch(h.row().querySelector('[data-field-feedback="title"]').textContent,/Unsaved/);
    }finally{h.close();}
});
test('lazy branches show local loading, preserve cursor paging and retain arbitrary nested depth',async()=>{
    const h=await fixture();try{
        h.board.updateTask({...h.board.getState().tasks.get('t'),activeChildCount:1});
        let release, first=true;const held=new Promise(r=>release=r),reads=[];
        h.branches(async url=>{
            const query=new URL(url,'https://fixture.invalid').searchParams,parent=JSON.parse(query.get('filters')).parentTaskId,cursor=query.get('cursor');reads.push({parent,cursor});
            if(first){first=false;await held;}
            if(parent==='t'&&cursor)return {tasks:[{id:'child2',parentTaskId:'t',rank:'1/1',title:'Second page',activeChildCount:0}],nextCursor:null};
            if(parent==='t')return {tasks:[{id:'child1',parentTaskId:'t',rank:'0/1',title:'Nested 1',activeChildCount:1}],nextCursor:'next'};
            const depth=Number(parent.replace('child',''));return {tasks:[{id:`child${depth+2}`,parentTaskId:parent,rank:'0/1',title:`Nested ${depth+2}`,activeChildCount:depth<9?1:0}],nextCursor:null};
        });
        h.row().querySelector('[data-action="toggle-task"]').click();assert.match(h.row().textContent,/Loading subtasks/);release();await tick();
        assert.equal(reads.length,1);assert.ok(h.row().querySelector('[data-action="load-subtasks"]'));
        h.row().querySelector('[data-action="load-subtasks"]').click();await tick();assert.deepEqual(reads[1],{parent:'t',cursor:'next'});assert.equal(h.row().querySelector('[data-action="load-subtasks"]'),null);
        for(const id of ['child1','child3','child5','child7','child9']){h.doc.querySelector(`[data-task-id="${id}"] [data-action="toggle-task"]`).click();await tick();}
        const deep=h.doc.querySelector('[data-task-id="child11"]');assert.equal(deep.dataset.depth,'6');assert.equal(deep.querySelector('.crm-board-depth-chip'),null);assert.ok(deep.querySelector('.crm-board-expander.is-leaf'));
        const before=reads.length;h.row().querySelector('[data-action="toggle-task"]').click();h.row().querySelector('[data-action="toggle-task"]').click();await tick();assert.equal(reads.length,before);
        assert.equal(h.writes.length,0);
    }finally{h.close();}
});
test('V2 row arrows traverse mounted logical rows without moving tasks and Space selects only the row',async()=>{
    const h=await fixture();try{
        h.row().focus();h.key(h.row(),'ArrowDown');assert.equal(h.doc.activeElement.dataset.taskId,'t1');
        h.key(h.doc.activeElement,'End');assert.equal(h.doc.activeElement.dataset.sectionId,'s2');assert.ok(h.elements.projectsBoardScroll.scrollTop>0);
        assert.equal(h.doc.activeElement.dataset.rowKind,'group-header');
        h.key(h.doc.activeElement,'ArrowUp');assert.equal(h.doc.activeElement.dataset.rowKind,'section');
        h.key(h.doc.activeElement,'ArrowUp');assert.equal(h.doc.activeElement.dataset.taskId,'t69');
        h.key(h.doc.activeElement,' ');assert.deepEqual([...h.board.getState().selectedTaskIds],['t69']);
        h.key(h.doc.activeElement,'Home');assert.equal(h.doc.activeElement.dataset.rowKind,'section');assert.equal(h.writes.length,0);
    }finally{h.close();}
});
test('Move to uses the existing structural command once and failure leaves the task in its original section',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="task-menu"]').click();h.doc.querySelector('[data-move-task]').click();
        const picker=h.doc.querySelector('[data-row-editor="move"]');picker.querySelector('[name="sectionId"]').value='s2';
        h.fail(409);picker.querySelector('[data-apply-move]').click();await tick();
        assert.equal(h.writes.length,1);assert.match(h.writes[0].url,/\/tasks\/t\/move$/);assert.equal(h.writes[0].body.sectionId,'s2');assert.equal(h.writes[0].body.parentTaskId,null);assert.equal(h.writes[0].body.expectedRevision,1);
        assert.equal(h.board.getState().tasks.get('t').sectionId,'s');assert.equal(h.doc.querySelector('[data-row-editor="move"]'),null);
    }finally{h.close();}
});
test('rename has explicit Save and Cancel controls for touch without requiring Enter',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="task-menu"]').click();h.doc.querySelector('[data-rename-task]').click();
        let input=h.row().querySelector('input[data-field-kind="title"]');input.value='Touch rename';h.input(input);
        assert.ok(h.row().querySelector('[data-action="save-rename"]'));h.row().querySelector('[data-action="save-rename"]').click();await tick();assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.title,'Touch rename');
        h.key(h.row(),'F2');input=h.row().querySelector('input[data-field-kind="title"]');input.value='Cancel touch';h.input(input);h.row().querySelector('[data-action="cancel-rename"]').click();await tick();assert.equal(h.writes.length,1);assert.equal(h.row().querySelector('.crm-board-title-button').textContent,'Touch rename');
    }finally{h.close();}
});
test('More actions exposes visible field editors for touch and custom writes use their descriptor ID',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="task-menu"]').click();assert.ok(h.doc.querySelector('[data-edit-field="status"]'));assert.ok(h.doc.querySelector('[data-edit-field="dates"]'));assert.ok(h.doc.querySelector('[data-edit-field="ownerUid"]'));
        h.doc.querySelector('[data-edit-field="custom:estimate"]').click();const picker=h.doc.querySelector('[data-row-editor="field"]');assert.ok(picker);
        const input=picker.querySelector('input');assert.equal(input.type,'number');input.value='0';h.input(input);picker.querySelector('[data-save-field]').click();await tick();
        assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.values.estimate,0);assert.equal(h.writes[0].body.estimate,undefined);
    }finally{h.close();}
});
test('the existing calendar picker does not dismiss its date-range editor on a touch selection',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();const picker=h.doc.querySelector('[data-row-editor="dates"]'),input=picker.querySelector('[name="startDate"]');
        h.win.CrmProjectsDatePicker.open(input);const day=h.doc.querySelector('[data-datepick-day="2026-09-02"]');assert.ok(day);
        day.dispatchEvent(new h.win.Event('pointerdown',{bubbles:true}));day.click();assert.ok(picker.isConnected);assert.equal(input.value,'2026-09-02');assert.equal(h.writes.length,0);
        h.win.CrmProjectsDatePicker.open(input);h.key(h.doc.activeElement,'Escape');assert.ok(picker.isConnected);assert.equal(h.doc.querySelector('.crm-datepick'),null);
    }finally{h.close();}
});
test('rename retains node, draft, caret and base across rank/scroll; arrows do not mutate rows',async()=>{
    const h=await fixture();try{h.key(h.row(),'F2');const editor=h.row().querySelector('input[data-field-kind="title"]');assert.ok(editor);
        editor.value='Draft name';h.input(editor);editor.setSelectionRange(2,5);h.board.updateTask({...h.board.getState().tasks.get('t'),rank:'9/2',revision:2});
        h.elements.projectsBoardScroll.scrollTop=2200;h.elements.projectsBoardScroll.dispatchEvent(new h.win.Event('scroll'));
        assert.equal(h.doc.activeElement,editor);assert.equal(editor.selectionStart,2);assert.equal(editor.value,'Draft name');
        h.key(editor,'ArrowDown');assert.equal(h.writes.length,0);h.key(editor,'Enter');await tick();assert.equal(h.writes[0].body.expectedRevision,1);
    }finally{h.close();}
});
test('owner transfer is one atomic patch; collaborators exclude owner and retain unavailable assignments',async()=>{
    const h=await fixture();try{
        const select=h.row().querySelector('[data-field-kind="assigneeUids"]');assert.deepEqual([...select.selectedOptions].map(o=>o.value),['b','former']);
        h.row().querySelector('[data-people-kind="ownerUid"]').click();h.doc.querySelector('[data-people-uid="b"]').click();await tick();
        assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.ownerUid,'b');assert.deepEqual(h.writes[0].body.assigneeUids,['former']);
        assert.ok(h.row().querySelector('[data-people-kind="ownerUid"] .crm-board-owner-avatar'),'focused owner keeps avatar markup');
        h.row().querySelector('[data-people-kind="assigneeUids"]').click();assert.ok(h.doc.querySelector('[data-people-uid="b"]').disabled);
        h.doc.querySelector('[data-people-uid="c"]').focus();h.doc.querySelector('[data-people-uid="c"]').click();await tick();assert.deepEqual(h.writes[1].body.assigneeUids.slice().sort(),['c','former']);
        assert.equal(h.doc.activeElement.dataset.peopleUid,'c','multi-pick retains the active option');
        h.doc.querySelector('[data-people-uid="a"]').click();await tick();assert.deepEqual(h.writes[2].body.assigneeUids.slice().sort(),['a','c','former']);
        h.key(h.doc.querySelector('[data-people-search]'),'Escape');assert.equal(h.doc.querySelector('.crm-people-popover'),null);assert.equal(h.doc.activeElement.dataset.peopleKind,'assigneeUids');
    }finally{h.close();}
});
test('typed custom values preserve zero/null/Unicode, real priority ID, unavailable options and unknown read-only values',async()=>{
    const h=await fixture();try{
        assert.equal(h.row().querySelector('[data-column-id="choice"] select').value,'removed');assert.match(h.row().querySelector('[data-column-key="custom:future"]').textContent,/<script>/);
        for(const [id,value,expected] of [['estimate','0',0],['estimate','',null],['notes','Đặng <b>','Đặng <b>'],['importance','urgent','urgent'],['phase','blocked','blocked'],['choice','',null],['deadline','2028-02-29','2028-02-29']]){
            const el=h.row().querySelector(`.crm-board-field[data-column-id="${id}"]`);el.value=value;h.change(el);await tick();assert.equal(h.writes.at(-1).body.values[id],expected);
        }
        const count=h.writes.length;
        await h.board.saveTaskField('t','value',{value:Infinity,type:'number',dataset:{columnId:'estimate'}});
        await h.board.saveTaskField('t','value',{value:'2026-02-30',dataset:{columnId:'deadline'}});
        await h.board.saveTaskField('t','value',{value:'bad',dataset:{columnId:'importance'}});
        await h.board.saveTaskField('t','value',{value:'overwrite',dataset:{columnId:'future'}});
        assert.equal(h.writes.length,count,'invalid and unknown typed writes rejected before dispatch');
    }finally{h.close();}
});
test('field feedback is visible through delayed, rapid, failure, conflict and uncertain saves',async()=>{
    const h=await fixture();try{
        const release=h.hold();const first=h.board.saveTaskField('t','status',{value:'blocked'});await tick();assert.match(h.row().querySelector('[data-field-feedback="status"]').textContent,/Saving/);
        const second=h.board.saveTaskField('t','status',{value:'done'});release();await first;await second;await tick();assert.deepEqual(h.writes.map(w=>w.body.expectedRevision),[1,2]);assert.match(h.row().querySelector('[data-field-feedback="status"]').textContent,/Saved/);
        for(const [status,label] of [[403,/not saved/i],[409,/conflict/i],[-1,/not confirmed/i]]){h.fail(status);await h.board.saveTaskField('t','status',{value:'in_progress'});assert.match(h.row().querySelector('[data-field-feedback="status"]').textContent,label);}
        const uncertain=h.writes.slice(-2);assert.equal(uncertain[0].body.operationId,uncertain[1].body.operationId);
    }finally{h.close();}
});
test('picker focus returns to connected trigger; stale scope and authority loss cannot write',async()=>{
    const h=await fixture();try{
        const trigger=h.row().querySelector('[data-action="pick-status"]');trigger.click();h.key(h.doc.activeElement,'ArrowDown');h.key(h.doc.activeElement,'Enter');await tick();assert.equal(h.doc.activeElement.dataset.action,'pick-status');assert.equal(h.writes.length,1);
        h.row().querySelector('[data-action="pick-status"]').click();const old=h.doc.querySelector('[data-status-key="done"]');h.select('other');await tick();old.click();await tick();assert.equal(h.writes.length,1);
        h.role('Viewer');await h.board.refresh();assert.equal(h.row().querySelector('[data-action="pick-status"]').disabled,true);
        await h.board.saveTaskField('t','title',{value:'Denied'});assert.equal(h.writes.length,1);
    }finally{h.close();}
});
test('date range preview/apply is atomic, clearable and validates date-only ranges',async()=>{
    const h=await fixture();try{
        // The table shows the range only; working-day detail lives in the date editor.
        assert.doesNotMatch(h.row().querySelector('[data-column-key="dates"]').textContent,/Working days/);
        h.row().querySelector('[data-action="edit-dates"]').click();const picker=h.doc.querySelector('[data-row-editor="dates"]');assert.ok(picker);
        const start=picker.querySelector('[name="startDate"]'),due=picker.querySelector('[name="dueDate"]');
        start.value='2026-09-22';due.value='2026-09-21';h.input(start);picker.querySelector('[data-preview-dates]').click();await tick();assert.equal(h.writes.length,0);assert.match(picker.textContent,/Start.*after/i);
        start.value='2026-09-02';h.input(start);picker.querySelector('[data-preview-dates]').click();await tick();assert.equal(h.writes.length,1);assert.match(h.writes[0].url,/schedule-preview$/);assert.equal(h.writes[0].body.dueDate,'2026-09-21');
        picker.querySelector('[data-apply-dates]').click();await tick();assert.equal(h.writes.length,2);assert.match(h.writes[1].url,/schedule-apply$/);assert.equal(h.writes[1].body.previewToken,'preview-token');assert.equal(h.writes[1].body.startDate,undefined);
        assert.match(h.row().querySelector('[data-action="edit-dates"]').textContent,/Sep 2/);
    }finally{h.close();}
});
test('row menu offers explicit rename/add-subtask/move for keyboard and touch; flag off retains legacy title',async()=>{
    let h=await fixture();try{h.row().querySelector('[data-action="task-menu"]').click();assert.ok(h.doc.querySelector('[data-row-editor="menu"] [data-rename-task]'));h.doc.querySelector('[data-move-task]').click();assert.ok(h.doc.querySelector('[data-row-editor="move"] select[name="parentTaskId"]'));assert.ok(h.doc.querySelector('[data-row-editor="move"] select[name="sectionId"]'));assert.equal(h.writes.length,0);}finally{h.close();}
    h=await fixture(false);try{assert.ok(h.row().querySelector('input[data-field-kind="title"]'));assert.equal(h.row().querySelector('.crm-board-title-button'),null);assert.equal(h.row().querySelector('[data-action="task-menu"]'),null);}finally{h.close();}
});
test('clearing date ranges uses one supported multi-field patch and no fabricated calendar preview',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();const picker=h.doc.querySelector('[data-row-editor="dates"]');
        for(const input of picker.querySelectorAll('input')){input.value='';h.input(input);}
        picker.querySelector('[data-preview-dates]').click();await tick();assert.equal(h.writes.length,0);
        picker.querySelector('[data-apply-dates]').click();await tick();assert.equal(h.writes.length,1);
        assert.match(h.writes[0].url,/\/tasks\/t$/);assert.equal(h.writes[0].body.startDate,null);assert.equal(h.writes[0].body.dueDate,null);
        assert.equal(h.writes[0].body.dates,undefined);
    }finally{h.close();}
});
test('malformed acknowledgement retains the rename draft without claiming success',async()=>{
    const h=await fixture();try{
        h.key(h.row(),'F2');const editor=h.row().querySelector('input[data-field-kind="title"]');editor.value='Unconfirmed name';h.input(editor);h.malformed();h.key(editor,'Enter');await tick();
        assert.ok(editor.isConnected);assert.equal(editor.value,'Unconfirmed name');assert.match(h.row().querySelector('[data-field-feedback="title"]').textContent,/Not confirmed/);
        assert.equal(h.board.getState().tasks.get('t').title,'Tiếng Việt <img src=x>');
    }finally{h.close();}
});
test('held save does not steal a newer editor focus/caret, and repeated Enter submits one rename',async()=>{
    const h=await fixture();try{
        h.key(h.row(),'F2');const title=h.row().querySelector('input[data-field-kind="title"]');title.value='One rename';h.input(title);
        const release=h.hold();h.key(title,'Enter');await tick();h.key(title,'Enter');
        const other=h.doc.querySelector('[data-task-id="t3"] input[data-column-id="notes"]');other.focus();other.value='Other draft';h.input(other);other.setSelectionRange(2,5);
        release();await tick();assert.equal(h.writes.length,1);assert.equal(h.doc.activeElement,other);assert.equal(other.selectionStart,2);
    }finally{h.close();}
});
test('date edits typed during delayed apply remain open and unsaved after the older acknowledgement',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();const picker=h.doc.querySelector('[data-row-editor="dates"]');
        const start=picker.querySelector('[name="startDate"]'),due=picker.querySelector('[name="dueDate"]');start.value='2026-09-02';due.value='2026-09-21';h.input(start);
        picker.querySelector('[data-preview-dates]').click();await tick();const release=h.hold();picker.querySelector('[data-apply-dates]').click();await tick();
        due.value='2026-09-22';h.input(due);release();await tick();assert.ok(picker.isConnected);assert.equal(due.value,'2026-09-22');assert.equal(picker.querySelector('[data-apply-dates]').disabled,true);
        assert.equal(h.writes.length,2);assert.match(h.row().querySelector('[data-field-feedback="dates"]').textContent,/Unsaved/);
    }finally{h.close();}
});
test('actor change cancels an in-flight acknowledgement and removes open picker content',async()=>{
    const h=await fixture();try{
        const release=h.hold();const saved=h.board.saveTaskField('t','status',{value:'blocked'});await tick();h.actor('other');
        h.row().querySelector('[data-action="pick-status"]').click();release();await saved;await tick();assert.equal(h.board.getState().tasks.size,0);assert.equal(h.doc.querySelector('.crm-status-popover'),null);
        assert.equal(h.events.at(-1).phase,'cancelled');
    }finally{h.close();}
});
test('schema changes reject a stale typed editor without coercing the saved value',async()=>{
    const h=await fixture();try{
        const control=h.row().querySelector('input[data-column-id="notes"]');control.focus();control.value='Unsent text';h.input(control);
        h.columns.find(c=>c.id==='notes').type='number';await h.board.refresh();
        await h.board.saveTaskField('t','value',control);assert.equal(h.writes.length,0);
        assert.equal(h.board.getState().tasks.get('t').values.notes,'Stored');
    }finally{h.close();}
});

test('Save dates previews once and applies only a current allowed warning-free result',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();
        let picker=h.doc.querySelector('[data-row-editor="dates"]');
        assert.equal(picker.querySelector('[data-review-dates]').hidden,true);
        const due=picker.querySelector('[name="dueDate"]');due.value='2026-09-25';h.input(due);
        picker.querySelector('[data-save-dates]').click();await tick();
        assert.deepEqual(h.writes.map(w=>w.url.split('/').at(-1)),['schedule-preview','schedule-apply']);
        assert.equal(picker.isConnected,false);assert.equal(h.board.getState().tasks.get('t').dueDate,'2026-09-25');
        h.preview([{code:'DEPENDENCY_WARNING',message:'Predecessor finishes later'}]);
        h.row().querySelector('[data-action="edit-dates"]').click();picker=h.doc.querySelector('[data-row-editor="dates"]');
        picker.querySelector('[data-save-dates]').click();await tick();
        assert.equal(h.writes.length,3);assert.equal(picker.querySelector('[data-apply-dates]').hidden,false);
        picker.querySelector('[data-apply-dates]').click();await tick();assert.equal(h.writes.length,4);
        h.preview([],false);h.row().querySelector('[data-action="edit-dates"]').click();picker=h.doc.querySelector('[data-row-editor="dates"]');
        picker.querySelector('[data-save-dates]').click();await tick();
        assert.equal(h.writes.length,5);assert.equal(picker.querySelector('[data-apply-dates]').disabled,true);
        assert.match(picker.textContent,/configuration/);
    }finally{h.close();}
});
test('retained date range paints the board and done tasks are not overdue',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();const picker=h.doc.querySelector('[data-row-editor="dates"]');
        const due=picker.querySelector('[name="dueDate"]');due.value='2020-09-20';
        picker.querySelector('[name="startDate"]').value='2020-09-01';h.input(due);
        h.key(picker,'Escape');
        assert.match(h.row().querySelector('[data-action="edit-dates"]').title,/2020-09-20/);
        assert.equal(h.row().querySelector('[data-column-key="dates"]').dataset.dueState,'overdue');
        h.remote({status:'done'});assert.equal(h.row().querySelector('[data-column-key="dates"]').dataset.dueState,'none');
        assert.equal(h.writes.length,0);
    }finally{h.close();}
});
test('calendar month and year changes retain logical focus and Escape returns to the date field',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="edit-dates"]').click();const field=h.doc.querySelector('[name="dueDate"]');
        h.win.CrmProjectsDatePicker.open(field);
        let month=h.doc.querySelector('[data-datepick-month]');month.focus();month.value='1';h.change(month);
        assert.equal(h.doc.activeElement,h.doc.querySelector('[data-datepick-month]'));
        let year=h.doc.querySelector('[data-datepick-year]');year.focus();year.value='2027';h.change(year);
        assert.equal(h.doc.activeElement,h.doc.querySelector('[data-datepick-year]'));
        h.key(h.doc.activeElement,'Escape');assert.equal(h.doc.activeElement,field);assert.equal(h.doc.querySelector('.crm-datepick'),null);
    }finally{h.close();}
});

test('project creation guards duplicate clicks, retains uncertain operation and recovers list refresh without recreation',async()=>{
    const h=await fixture();try{
        const name=h.elements.projectsBoardProjectName, button=h.doc.getElementById('btn-projects-board-save-project');
        name.value='Original project';h.fail(-1);const release=h.hold();button.click();button.click();await tick();
        assert.equal(h.writes.length,1);release();await tick();assert.equal(button.textContent,'Retry creation');
        const original=JSON.stringify(h.writes[0].body);name.value='Edited while uncertain';h.fail(0);button.click();await tick();
        assert.equal(h.writes.length,2);assert.equal(JSON.stringify(h.writes[1].body),original);
        assert.equal(button.textContent,'Refresh project list');h.refreshResult(true);button.click();await tick();
        assert.equal(h.writes.length,2);assert.equal(h.elements.projectsBoardCreateProject.hidden,true);
    }finally{h.close();}
});

test('Move defaults to the current parent and unchanged destination sends no command',async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="task-menu"]').click();
        h.board.updateTask({...h.board.getState().tasks.get('t'),parentTaskId:'unloaded-parent',ancestorIds:['unloaded-parent']});
        h.doc.querySelector('[data-move-task]').click();
        const picker=h.doc.querySelector('[data-row-editor="move"]');assert.equal(picker.querySelector('[name="parentTaskId"]').value,'unloaded-parent');
        picker.querySelector('[data-apply-move]').click();await tick();assert.equal(h.writes.length,0);assert.equal(picker.isConnected,false);
    }finally{h.close();}
});
test('Move branch read failure retains choices and makes retry available',async()=>{
    const h=await fixture();try{
        h.board.updateTask({...h.board.getState().tasks.get('t1'),activeChildCount:undefined,childCount:1});
        h.branches(async()=>{throw new Error('Destination unavailable');});
        h.row().querySelector('[data-action="task-menu"]').click();h.doc.querySelector('[data-move-task]').click();
        const picker=h.doc.querySelector('[data-row-editor="move"]');picker.querySelector('[name="parentTaskId"]').value='t1';
        picker.querySelector('[data-apply-move]').click();await tick();
        assert.equal(picker.isConnected,true);assert.equal(picker.querySelector('[name="parentTaskId"]').value,'t1');
        assert.equal(picker.querySelector('[data-apply-move]').disabled,false);assert.match(picker.querySelector('[data-move-result]').textContent,/try|retry/i);assert.equal(h.writes.length,0);
    }finally{h.close();}
});

test('expired or remotely stale date preview cannot apply and retains the date draft',async()=>{
    for(const stale of ['expired','revision']){
        const h=await fixture();try{
            h.preview([{code:'WARNING',message:'Review dates'}]);
            h.row().querySelector('[data-action="edit-dates"]').click();const picker=h.doc.querySelector('[data-row-editor="dates"]');
            const due=picker.querySelector('[name="dueDate"]');due.value='2026-09-25';h.input(due);
            picker.querySelector('[data-save-dates]').click();await tick();assert.equal(h.writes.length,1);
            if(stale==='expired'){const now=h.win.Date.now();h.win.Date.now=()=>now+15*60000;}else h.remote({status:'done'});
            picker.querySelector('[data-apply-dates]').click();await tick();assert.equal(h.writes.length,1);
            assert.equal(due.value,'2026-09-25');assert.equal(picker.querySelector('[data-review-dates]').hidden,false);
            assert.match(picker.querySelector('[data-date-result]').textContent,/no longer current/);
        }finally{h.close();}
    }
});
