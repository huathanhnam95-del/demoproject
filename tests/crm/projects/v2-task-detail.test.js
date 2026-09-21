'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for (let i = 0; i < 16; i++) await new Promise(setImmediate); };
function surfaceFixture(options = {}) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window, doc = win.document, panel = doc.querySelector('[data-panel="projects"]'), dialog = doc.getElementById('projects-board-detail');
    const source = path.join(root, 'public/js/crm/projects/presentation/detail-surface.js');
    if (fs.existsSync(source)) win.eval(fs.readFileSync(source, 'utf8'));
    let width = 1280, closes = 0, returns = 0;
    panel.getBoundingClientRect = () => ({ width, left: 0, right: width, top: 0, bottom: 900 });
    const modes = [];
    dialog.show = function () { assert.equal(this.open, false, 'native mode changes must close first'); this.open = true; modes.push('drawer'); };
    dialog.showModal = function () { assert.equal(this.open, false, 'native mode changes must close first'); this.open = true; modes.push('modal'); };
    dialog.close = function () { this.open = false; win.setTimeout(() => this.dispatchEvent(new win.Event('close')), 0); };
    assert.ok(win.CrmProjectsDetailSurfaceV2, 'explicit detail surface owner is registered');
    const surface = win.CrmProjectsDetailSurfaceV2.createController({ panel, dialog, onClose: () => closes++, fallbackFocus: () => returns++, ...options });
    surface.init(); surface.init();
    return { dom, win, doc, panel, dialog, surface, modes, closes: () => closes, returns: () => returns, resize(value) { width = value; win.dispatchEvent(new win.Event('resize')); }, close() { surface.dispose(); dom.window.close(); } };
}
test('single owner retains tab, composer, caret and scroll through native mode transitions and stale close events', async () => {
    const h = surfaceFixture(); try {
        h.surface.sync({ id: 't' });
        const composer = h.doc.getElementById('projects-board-discussion-input');
        h.doc.getElementById('projects-detail-tab-updates').click(); composer.value = 'Bản nháp tiếng Việt'; composer.focus(); composer.setSelectionRange(3, 7); h.dialog.scrollTop = 80;
        h.resize(700); await tick(); h.resize(1280); await tick();
        assert.deepEqual(h.modes, ['drawer', 'modal', 'drawer']); assert.equal(h.dialog.open, true); assert.equal(h.closes(), 0);
        assert.equal(h.doc.getElementById(composer.id), composer); assert.equal(composer.value, 'Bản nháp tiếng Việt'); assert.equal(composer.selectionStart, 3);
        h.surface.sync({ id: 't', revision: 2 }); assert.equal(h.doc.getElementById('projects-detail-tab-updates').getAttribute('aria-selected'), 'true');
        assert.equal(h.dialog.scrollTop, 80);
    } finally { h.close(); }
});
test('close actions are canonical once; repeated cycles and disposal release ownership and restore hosts', async () => {
    const h = surfaceFixture(), body = h.doc.getElementById('projects-board-detail-body'); try {
        for (const action of ['button', 'escape', 'backdrop']) {
            h.surface.sync({ id: 't' });
            if (action === 'button') h.doc.getElementById('btn-projects-board-close-detail').click();
            if (action === 'escape') h.dialog.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            if (action === 'backdrop') { h.resize(390); h.dialog.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true, clientX: -1, clientY: -1 })); }
            await tick(); assert.equal(h.dialog.open, false);
        }
        assert.equal(h.closes(), 3); assert.equal(h.returns(), 3);
        h.surface.dispose(); h.surface.dispose(); assert.equal(body.parentNode, h.dialog);
        h.doc.getElementById('btn-projects-board-close-detail').click(); assert.equal(h.closes(), 3);
    } finally { h.close(); }
});
test('forced invalidation clears private content without focus restoration and unsupported tabs stay absent', () => {
    const h = surfaceFixture(); try {
        h.surface.sync({ id: 'private' }); h.doc.getElementById('projects-board-detail-title').textContent = 'Private title';
        h.surface.forceClose({ clear: true }); assert.equal(h.dialog.open, false); assert.equal(h.doc.getElementById('projects-board-detail-title').textContent, ''); assert.equal(h.returns(), 0);
        assert.equal(h.dialog.querySelector('[data-detail-tab="files"], [data-detail-tab="activity"]'), null);
    } finally { h.close(); }
});

async function fixture(v2 = true) {
    const dom = new JSDOM(fs.readFileSync(path.join(root,'public/crm-admin.html'),'utf8'), {runScripts:'outside-only',url:'https://fixture.invalid',pretendToBeVisual:true});
    const win=dom.window, doc=win.document;
    win.HTMLDialogElement.prototype.show = function(){this.open=true;};
    win.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
    win.HTMLDialogElement.prototype.close = function(){this.open=false;};
    doc.querySelector('[data-panel="projects"]').getBoundingClientRect=()=>({width:1280});
    for(const name of ['presentation/column-model','presentation/table-layout','presentation/field-feedback','state','presentation/detail-surface','board','date-picker']) win.eval(fs.readFileSync(path.join(root,`public/js/crm/projects/${name}.js`),'utf8'));
    win.CrmProjectsDatePicker.init();
    doc.querySelector('[data-panel="projects"]').setAttribute('data-projects-ui',v2?'v2':'legacy');
    const admin=fs.readFileSync(path.join(root,'public/crm-admin.js'),'utf8');
    const elements=Object.fromEntries([...admin.matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m=>[m[1],doc.getElementById(m[2])]));
    let actor='a',role='Owner',fail=0,malformed=false,hold=null,readHold=null,branchResponder=null;
    const columns=[{id:'notes',label:'Notes',type:'text'},{id:'estimate',label:'Estimate',type:'number'},{id:'deadline',label:'Deadline',type:'date'},{id:'importance',label:'Priority',type:'priority'},{id:'phase',label:'Phase',type:'status',statusLabels:{done:'Finished'}},{id:'choice',label:'Choice',type:'dropdown',options:[{key:'yes',label:'Yes'}]},{id:'team',label:'Team',type:'people'},{id:'future',type:'future'}];
    let task={id:'t',sectionId:'s',title:'Tiếng Việt <img src=x>',status:'not_started',rank:'0/1',revision:1,activeChildCount:0,ownerUid:'a',assigneeUids:['b','former'],startDate:'2026-09-01',dueDate:'2026-09-20',values:{notes:'Stored',estimate:0,importance:'high',phase:'done',choice:'removed',team:['former'],future:{safe:'<script>'}}};
    const tasks=Array.from({length:70},(_,i)=>({...task,id:i?`t${i}`:'t',rank:`${i}/1`}));
    const writes=[],events=[],reads=[];
    const board=win.CrmProjectsBoard.createController({elements,presentationV2:v2,getCurrentUser:()=>({uid:actor}),onFieldSaveEvent:e=>events.push(e),apiFetchJson:async(url,options)=>{
        if(options){const body=JSON.parse(options.body||'{}');writes.push({url,body}); if(hold){const wait=hold;hold=null;await wait;}
            if(fail)throw Object.assign(new Error('Fixture denied/conflict/unconfirmed'),fail===-1?{}:{status:fail});
            if(malformed)return {ok:true};
            if(url.endsWith('/tasks')){const created={...task,id:'persisted-new',title:body.title,sectionId:body.sectionId,rank:`${tasks.length}/1`,revision:1};tasks.push(created);return {task:created};}
            if(body.expectedRevision!==undefined && body.expectedRevision!==task.revision)throw Object.assign(new Error('Revision conflict'),{status:409});
            if(url.endsWith('/schedule-preview')){previewDates={startDate:body.startDate,dueDate:body.dueDate};return {preview:{token:'preview-token',canApply:true,taskId:'t',after:{startDate:body.startDate,dueDate:body.dueDate},workingDayCount:12,warnings:[]}};}
            if(url.endsWith('/schedule-apply')){task={...task,...previewDates,revision:task.revision+1};tasks[0]=task;return {result:{task}};}
            task={...task,...body,values:{...task.values,...body.values},revision:task.revision+1};tasks[0]=task;return {task};}
        if(url.includes('member-directory'))return {people:[{uid:'a',displayName:'Owner A'},{uid:'b',displayName:'Collaborator B'},{uid:'c',displayName:'Nguyễn C'}]};
        if(url.includes('/tasks?'))return branchResponder ? branchResponder(url) : {tasks,columns,sections:[{id:'s',title:'Section',rank:'0/1'},{id:'s2',title:'Other',rank:'1/1'}],revision:{schemaRevision:1,structureRevision:1}};
        if(url.endsWith('/tasks/t')){reads.push(url);if(readHold){const wait=readHold;readHold=null;await wait;}return {task};}
        return {project:{id:url.split('/').pop(),lifecycle:'active'},membership:{role}};
    }});
    let previewDates={startDate:'2026-09-02',dueDate:'2026-09-21'};
    board.init();const select=id=>board.setProjects({projects:[{id,lifecycle:'active'}],selectedProjectId:id});select('p');await tick();
    return {win,doc,board,elements,writes,events,reads,columns,select,server(patch){task={...task,...patch,revision:task.revision+1};tasks[0]=task;},remote(patch){task={...task,...patch,revision:task.revision+1};tasks[0]=task;board.updateTask(task);},branches:fn=>branchResponder=fn,row:()=>doc.querySelector('[data-task-id="t"]'),key:(el,key,extra={})=>el.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra})),change:el=>el.dispatchEvent(new win.Event('change',{bubbles:true})),input:el=>el.dispatchEvent(new win.Event('input',{bubbles:true})),actor:v=>actor=v,role:v=>role=v,fail:v=>fail=v,malformed:()=>malformed=true,holdRead(){let release;readHold=new Promise(r=>release=r);return release;},hold(){let release;hold=new Promise(r=>release=r);return release;},close(){board.disposePresentation();win.close();}};
}

 test('board owns opening, Overview editors and logical virtual focus return; no private content on scope change', async()=>{
    const h=await fixture();try{
        h.row().querySelector('[data-action="open-detail"]').click();
        const dialog=h.elements.projectsBoardDetail, body=h.elements.projectsBoardDetailBody;
        assert.equal(dialog.open,true);assert.equal(dialog.dataset.detailMode,'drawer');
        assert.equal(body.closest('[data-detail-panel]').dataset.detailPanel,'details');
        assert.ok(body.querySelector('[data-field-kind="title"]'));
        const notes=body.querySelector('.crm-board-field[data-column-id="notes"]'); notes.focus();notes.value='Nháp mới';h.input(notes);
        h.remote({status:'done'});assert.equal(body.querySelector('.crm-board-field[data-column-id="notes"]'),notes);assert.equal(notes.value,'Nháp mới');
        h.change(notes);await tick();assert.equal(h.writes.length,1,'stale revision is sent through the canonical save');assert.equal(h.events.at(-1).phase,'conflict');assert.equal(notes.value,'Nháp mới');assert.ok(dialog.querySelector('[data-remote-conflict-review]'));
        h.elements.projectsBoardScroll.scrollTop=2400;h.elements.projectsBoardScroll.dispatchEvent(new h.win.Event('scroll'));await tick();
        h.doc.getElementById('btn-projects-board-close-detail').click();
        assert.equal(dialog.open,false);assert.equal(h.board.getState().selectedTaskId,'');assert.equal(h.doc.activeElement.closest('[data-task-id]')?.dataset.taskId,'t');
        h.row().querySelector('[data-action="open-detail"]').click();h.select('q');assert.equal(dialog.open,false);assert.equal(body.textContent,'');assert.equal(h.elements.projectsBoardDetailTitle.textContent,'');await tick();
    }finally{h.close();}
 });
test('one owner refuses a second mount; Promise close hooks cannot accidentally authorize close', () => {
    const h = surfaceFixture({ beforeClose: () => Promise.resolve(true) }); try {
        assert.throws(() => h.win.CrmProjectsDetailSurfaceV2.createController({ dialog: h.dialog, panel: h.panel }).init(), /already/);
        h.surface.sync({ id: 't' }); h.surface.requestClose(); assert.equal(h.dialog.open, true); assert.equal(h.closes(), 0);
        h.surface.forceClose(); assert.equal(h.dialog.open, false);
    } finally { h.close(); }
});
test('optimistic ID settlement retains the active tab and logical return task', () => {
    let returned;
    const h = surfaceFixture({ fallbackFocus: id => { returned = id; } }); try {
        h.surface.sync({ id: 'temporary' }); h.doc.getElementById('projects-detail-tab-updates').click();
        assert.equal(typeof h.surface.replaceTaskId, 'function'); h.surface.replaceTaskId('temporary', 'canonical');
        h.surface.sync({ id: 'canonical' }); assert.equal(h.doc.getElementById('projects-detail-tab-updates').getAttribute('aria-selected'), 'true');
        h.surface.requestClose(); assert.equal(returned, 'canonical');
    } finally { h.close(); }
});
for (const v2 of [false, true]) {
    const presentation = v2 ? 'V2' : 'default';
    test(`${presentation} Board retains explicit optimistic detail intent, canonical identity and tab after creation acknowledgment`, async () => {
        const h = await fixture(v2); try {
            const release = h.hold();
            const creating = h.board.createTask(null, 's', { initialTitle: 'Newly created' });
            await tick();
            assert.equal(h.writes.length, 1);
            assert.equal(h.writes[0].url, '/api/projects/p/tasks');
            const temporary = [...h.board.getState().tasks.values()].find(task => task.isOptimistic);
            assert.ok(temporary);
            const row = h.doc.querySelector(`[data-task-id="${temporary.id}"]`);
            row.focus(); h.key(row, 'Enter'); await tick();
            const tab = v2 ? 'updates' : 'details';
            h.board.activateDetailTab(tab);
            assert.equal(h.elements.projectsBoardDetail.hidden, false);
            assert.equal(h.board.getState().selectedTaskId, temporary.id);
            release(); await creating; await tick();
            assert.equal(h.elements.projectsBoardDetail.hidden, false, 'explicitly opened details remain visible');
            if (v2) assert.equal(h.elements.projectsBoardDetail.open, true);
            assert.equal(h.board.getState().selectedTaskId, 'persisted-new');
            assert.equal(h.board.getState().tasks.has(temporary.id), false);
            assert.equal(h.board.getState().tasks.get('persisted-new').title, 'Newly created');
            assert.equal(h.elements.projectsBoardDetailTitle.textContent, 'Newly created');
            assert.equal(h.doc.querySelector('[data-detail-tab][aria-selected="true"]').dataset.detailTab, tab);
            h.board.closeTask(); await tick();
            assert.equal(h.elements.projectsBoardDetail.hidden, true);
            if (v2) assert.equal(h.doc.activeElement.closest('[data-task-id]')?.dataset.taskId, 'persisted-new');
        } finally { h.close(); }
    });

    for (const action of ['unopened', 'keyboard', 'closed', 'project', 'actor', 'access']) {
        test(`${presentation} creation acknowledgment cannot open ${action} details`, async () => {
            const h = await fixture(v2); try {
                const release = h.hold();
                const creating = h.board.createTask(null, 's', { initialTitle: 'Pending task' });
                await tick(); assert.equal(h.writes.length, 1);
                const temporary = [...h.board.getState().tasks.values()].find(task => task.isOptimistic);
                const row = h.doc.querySelector(`[data-task-id="${temporary.id}"]`);
                row.focus();
                if (action === 'keyboard') h.key(row, 'ArrowUp');
                if (!['unopened', 'keyboard'].includes(action)) {
                    h.key(row, 'Enter'); await tick();
                    assert.equal(h.elements.projectsBoardDetail.hidden, false);
                    if (action === 'closed') h.board.closeTask();
                    if (action === 'project') h.select('q');
                    if (action === 'actor') { h.actor('other'); h.board.invalidateAccess('p'); }
                    if (action === 'access') h.board.invalidateAccess('p');
                }
                await tick();
                assert.equal(h.elements.projectsBoardDetail.hidden, true);
                release(); await creating; await tick();
                assert.equal(h.elements.projectsBoardDetail.hidden, true, 'settlement cannot create a new open intent');
                assert.equal(h.elements.projectsBoardDetail.open, false);
                if (['project', 'actor', 'access'].includes(action)) {
                    assert.notEqual(h.board.getState().selectedTaskId, 'persisted-new');
                    assert.equal(h.board.getState().tasks.has('persisted-new'), false);
                    if (v2) assert.equal(h.elements.projectsBoardDetailTitle.textContent, '');
                } else assert.equal(h.board.getState().tasks.has('persisted-new'), true);
            } finally { h.close(); }
        });
    }
}

test('a new task navigation replaces a still-connected return element', () => {
    const h = surfaceFixture(); try {
        const first = h.doc.createElement('button'), next = h.doc.createElement('button'); h.doc.body.append(first, next);
        h.surface.sync({ id: 'a' }, { opener: first }); h.surface.sync({ id: 'b' }, { opener: next });
        h.surface.requestClose(); assert.equal(h.doc.activeElement, next);
    } finally { h.close(); }
});
test('Overview shows the canonical dirty saving saved feedback with one field command', async () => {
    const h = await fixture(); try {
        h.row().querySelector('[data-action="open-detail"]').click(); const body = h.elements.projectsBoardDetailBody;
        const field = body.querySelector('.crm-board-field[data-column-id="notes"]'); field.value = 'Một cập nhật'; h.input(field);
        assert.equal(body.querySelector('[data-field-feedback="value:notes"]')?.dataset.phase, 'dirty');
        const release = h.hold(); h.change(field); await tick(); assert.equal(body.querySelector('[data-field-feedback="value:notes"]')?.dataset.phase, 'saving');
        release(); await tick(); assert.equal(h.writes.length, 1); assert.equal(body.querySelector('[data-field-feedback="value:notes"]')?.dataset.phase, 'saved');
    } finally { h.close(); }
});
test('Overview add subtask keeps drawer open and mounts creation composer inside drawer', async () => {
    const h = await fixture(); try {
        h.row().querySelector('[data-action="open-detail"]').click();
        h.elements.projectsBoardDetailBody.querySelector('[data-detail-add]').click();
        assert.equal(h.elements.projectsBoardDetail.open, true);
        const composer = h.elements.projectsBoardDetailBody.querySelector('[data-quick-create]');
        assert.ok(composer, 'composer should be mounted in drawer');
        assert.equal(composer.dataset.inDrawer, 'true');
        assert.ok(h.doc.activeElement.closest('.crm-quick-create'));
    } finally { h.close(); }
});
test('switching tasks in a desktop drawer returns focus to the latest logical task', async () => {
    const h = await fixture(); try {
        const first = h.row().querySelector('[data-action="open-detail"]'); first.focus(); first.click();
        const next = h.elements.projectsBoardRows.querySelector('[data-task-id="t1"] [data-action="open-detail"]'); next.focus(); next.click();
        h.doc.getElementById('btn-projects-board-close-detail').click();
        assert.equal(h.doc.activeElement.closest('[data-task-id]')?.dataset.taskId, 't1');
    } finally { h.close(); }
});
test('V2-off keeps legacy detail visibility and date-picker parent ownership', async () => {
    const h = await fixture(false); try {
        h.row().querySelector('[data-action="open-detail"]').click();
        assert.equal(h.elements.projectsBoardDetail.hidden, false); assert.equal(h.elements.projectsBoardDetail.dataset.detailMode, undefined);
        const field = h.doc.createElement('input'); field.type = 'date'; h.elements.projectsBoardDetail.append(field); h.elements.projectsBoardDetail.showModal();
        field.dispatchEvent(new h.win.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(h.doc.querySelector('.crm-datepick').parentNode, h.doc.querySelector('[data-panel="projects"]'));
    } finally { h.close(); }
});
test('a disposed board cannot compete with a replacement detail owner on the same DOM', async () => {
    const h = await fixture(); let replacement; try {
        h.board.disposePresentation(); let resets = 0;
        h.win.CrmProjectsDiscussion = { setSelection: () => resets++ };
        replacement = h.win.CrmProjectsDetailSurfaceV2.createController({ panel: h.doc.querySelector('[data-panel="projects"]'), dialog: h.elements.projectsBoardDetail });
        replacement.init(); replacement.sync({ id: 'replacement' });
        h.doc.getElementById('btn-projects-board-close-detail').click();
        assert.equal(resets, 0, 'released board detail listeners must not reset the new owner discussion');
    } finally { replacement?.dispose(); h.close(); }
});
test('row date draft stays mounted after unrelated board renders with no selected detail', async () => {
    const h = await fixture(); try {
        h.row().querySelector('[data-action="edit-dates"]').click(); const editor = h.doc.querySelector('.crm-row-editor');
        h.remote({ status: 'done' }); assert.equal(h.doc.querySelector('.crm-row-editor'), editor);
    } finally { h.close(); }
});
for (const loss of ['actor', 'project', 'role', 'task']) test(`open detail clears sensitive content on ${loss} loss and delayed writes cannot reopen it`, async () => {
    const h = await fixture(); try {
        h.row().querySelector('[data-action="open-detail"]').click(); const body = h.elements.projectsBoardDetailBody;
        const field = body.querySelector('.crm-board-field[data-column-id="notes"]'); field.value = 'Pending draft'; h.input(field);
        const release = h.hold(); h.change(field); await tick(); assert.equal(h.writes.length, 1);
        if (loss === 'actor') { h.actor('new'); h.board.invalidateAccess('p'); }
        if (loss === 'project') h.select('q');
        if (loss === 'role') { h.role('Viewer'); h.board.refresh(); await tick(); }
        if (loss === 'task') await h.board.applyRemote({ authority: { project: {...h.board.getState().project, structureRevision:1, schemaRevision:1}, membership: h.board.getState().membership }, isCurrent: () => true, changes: [{ taskId: 't' }], hydration: { tasks: [], unavailableTaskIds: ['t'] } });
        if (loss !== 'role') { assert.equal(h.elements.projectsBoardDetail.open, false); assert.equal(body.textContent, ''); }
        if (loss === 'task') assert.equal(h.doc.activeElement.id, 'projects-workspace-name');
        release(); await tick();
        assert.equal(h.elements.projectsBoardDetail.open, false); assert.equal(body.textContent, ''); assert.equal(h.elements.projectsBoardDetailTitle.textContent, '');
    } finally { h.close(); }
});
test('discussion host, file input and draft survive refresh and task switches without duplicated selection listeners', async () => {
    const h = await fixture(); try {
        h.win.eval(fs.readFileSync(path.join(root, 'public/js/crm/projects/discussion.js'), 'utf8'));
        let reads = 0, release;
        const discussion = h.win.CrmProjectsDiscussion.createController({ elements: h.elements, getCurrentUser: () => ({ uid: 'a' }), apiFetchJson: async url => {
            if (url.includes('/discussion')) { reads++; if (reads === 1) await new Promise(resolve => { release = resolve; }); return { messages: [{ id: 'm', body: 'Private delayed message', taskId: 't' }] }; }
            return { people: [] };
        } });
        discussion.init(); h.win.CrmProjectsDiscussion.setSelection = discussion.setSelection;
        h.row().querySelector('[data-action="open-detail"]').click(); await tick();
        const host = h.elements.projectsBoardDiscussion, input = h.elements.projectsBoardDiscussionInput;
        h.doc.getElementById('projects-detail-tab-updates').click(); input.value = 'Bản nháp'; h.input(input);
        h.remote({ status: 'done' }); assert.equal(h.elements.projectsBoardDiscussion, host); assert.equal(input.value, 'Bản nháp'); assert.equal(reads, 1);
        h.board.selectTask(h.board.getState().tasks.get('t1')); await tick(); assert.equal(input.value, '');
        h.board.selectTask(h.board.getState().tasks.get('t')); await tick(); assert.equal(input.value, 'Bản nháp');
        h.board.invalidateAccess('p'); release(); await tick(); assert.equal(input.value, ''); assert.equal(host.textContent.includes('Private delayed message'), false);
    } finally { h.close(); }
});
 for(const picker of ['people','dates','custom']) test(`Overview ${picker} picker stays in the active modal`,async()=>{
    const h=await fixture();try{
        h.doc.querySelector('[data-panel="projects"]').getBoundingClientRect=()=>({width:390});h.win.dispatchEvent(new h.win.Event('resize'));
        h.row().querySelector('[data-action="open-detail"]').click();const body=h.elements.projectsBoardDetailBody,dialog=h.elements.projectsBoardDetail;
        if(picker==='people'){body.querySelector('[data-people-kind="ownerUid"]').click();assert.ok(dialog.querySelector('.crm-people-popover'));}
        if(picker==='dates'){body.querySelector('[data-action="edit-dates"]').click();const date=dialog.querySelector('[name="dueDate"]');assert.ok(date);date.dispatchEvent(new h.win.MouseEvent('mousedown',{bubbles:true}));assert.ok(dialog.querySelector('.crm-datepick'));}
        if(picker==='custom'){const control=body.querySelector('.crm-board-field[data-column-id="deadline"]');control.dispatchEvent(new h.win.MouseEvent('mousedown',{bubbles:true}));assert.ok(dialog.querySelector('.crm-datepick'));}
        h.key(h.doc.activeElement,'Escape');assert.equal(dialog.open,true,'first Escape dismisses picker');
        h.board.invalidateAccess('p');assert.equal(dialog.open,false);assert.equal(body.textContent,'');assert.equal(h.doc.querySelector('.crm-datepick,.crm-people-popover,.crm-row-editor'),null);
    }finally{h.close();}
 });

async function detailConflict(h) {
    h.row().querySelector('[data-action="open-detail"]').click();
    const field = h.elements.projectsBoardDetailBody.querySelector('.crm-board-field[data-column-id="notes"]');
    field.value = 'First draft'; h.input(field);
    h.server({ values: { notes: 'Authoritative remote value' } });
    h.change(field); await tick();
    assert.equal(h.writes.length, 1); assert.equal(h.events.at(-1).phase, 'conflict');
    const review = h.elements.projectsBoardDetail.querySelector('[data-remote-conflict-review="t"]');
    assert.ok(review, 'canonical recovery must be inside the active detail surface');
    assert.equal(h.doc.querySelectorAll('[data-remote-conflict-review]').length, 1);
    return review;
}
test('detail 409 recovery reads authority, retains newer draft and requires review for exactly one canonical retry', async () => {
    const h = await fixture(); try {
        const review = await detailConflict(h);
        let confirms = 0; h.win.confirm = message => { confirms++; assert.match(message, /Authoritative remote value/); return false; };
        review.click(); await tick(); assert.equal(h.reads.length, 1); assert.equal(h.writes.length, 1);
        const release = h.holdRead(); review.click(); review.click(); await tick();
        assert.equal(h.reads.length, 2); assert.equal(review.disabled, true);
        const field = h.elements.projectsBoardDetailBody.querySelector('.crm-board-field[data-column-id="notes"]');
        field.value = 'Latest retained draft'; h.input(field);
        h.win.confirm = message => { confirms++; assert.match(message, /Authoritative remote value/); return true; };
        release(); await tick();
        assert.equal(confirms, 2); assert.equal(h.writes.length, 2);
        assert.equal(h.writes[1].body.expectedRevision, 2);
        assert.equal(h.writes[1].body.values.notes, 'Latest retained draft');
        assert.notEqual(h.writes[0].body.operationId, h.writes[1].body.operationId);
        assert.equal(h.doc.querySelectorAll('[data-remote-conflict-review]').length, 0);
        review.click(); await tick(); assert.equal(h.writes.length, 2, 'detached retry is inert');
        assert.equal(h.elements.projectsBoardDetailBody.querySelector('.crm-board-field[data-column-id="notes"]').value, 'Latest retained draft');
    } finally { h.close(); }
});
for (const loss of ['task', 'close-reopen', 'actor', 'project', 'access', 'role']) test(`detail conflict review is fenced during delayed authority read on ${loss}`, async () => {
    const h = await fixture(); try {
        const review = await detailConflict(h), release = h.holdRead();
        let confirms = 0; h.win.confirm = () => { confirms++; return true; };
        review.click(); await tick(); assert.equal(h.reads.length, 1);
        if (loss === 'task') h.board.selectTask({ id: 't1' });
        if (loss === 'close-reopen') { h.doc.getElementById('btn-projects-board-close-detail').click(); h.row().querySelector('[data-action="open-detail"]').click(); }
        if (loss === 'actor') { h.actor('other'); h.board.refresh(); }
        if (loss === 'project') h.select('q');
        if (loss === 'access') h.board.invalidateAccess('p');
        if (loss === 'role') { h.role('Viewer'); h.board.refresh(); }
        await tick(); release(); await tick();
        assert.equal(confirms, 0); assert.equal(h.writes.length, 1);
        assert.equal(h.doc.querySelectorAll('[data-remote-conflict-review]').length, 0);
        review.click(); await tick(); assert.equal(h.reads.length, 1, 'stale retained action cannot read');
    } finally { h.close(); }
});
