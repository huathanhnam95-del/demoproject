'use strict';
// Chrome acceptance uses real emulator Auth, Firestore, production Projects/CRM
// route handlers and the shipped shell. No controller or response mocks.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase5-test-helpers');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const ROOT = path.resolve(__dirname, '../../..');
const PROJECT = `remote-browser-${Date.now()}`;
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/remote-browser-discussion-browser');
const result = { cases: [], screenshots: [], network: [], console: [], pageErrors: [], persisted: {}, startedAt: new Date().toISOString() };
const endpoint = value => { const [host, port] = value.split(':'); return { host, port: Number(port) }; };
function configuration() { return { success: true, config: { apiKey: 'demo-key', authDomain: 'demo-crm-projects.firebaseapp.com', projectId: 'demo-crm-projects', storageBucket: 'demo-crm-projects.appspot.com', appId: '1:000:web:phase5' }, emulators: { auth: endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST), firestore: endpoint(process.env.FIRESTORE_EMULATOR_HOST), storage: endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST) }, features: { projects: true } }; }
function loginHtml() { return `<!doctype html><meta charset="utf-8"><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>(async()=>{const p=await(await fetch('/api/config')).json();firebase.initializeApp(p.config);firebase.auth().useEmulator('http://'+p.emulators.auth.host+':'+p.emulators.auth.port,{disableWarnings:true});await firebase.auth().signInWithEmailAndPassword(new URLSearchParams(location.search).get('email'),${JSON.stringify(h.PASSWORD)});location.replace('/crm-admin.html#projects')})().catch(e=>document.body.textContent=e.message)</script>`; }
async function mountShell(c) {
    const authMiddleware = async (req, res, next) => { try { req.user = await c.auth.verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); next(); } catch (_) { res.status(401).json({ success: false }); } };
    const currentAdmin = async uid => (await c.db.collection('users').doc(uid).get()).data()?.isAdmin === true;
    const adminMiddleware = async (req, res, next) => { if (await currentAdmin(req.user.uid)) next(); else res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' }); };
    c.api.use('/api/admin', createCrmRouter({ identity: require('../../../functions/src/studentIdentity'), db: c.db, authMiddleware, adminMiddleware, resolveAdminStatus: async ({ req }) => ({ isAdmin: await currentAdmin(req.user.uid), uid: req.user.uid }), serverTimestamp: () => new Date() }));
    c.api.get('/api/config', (_req, res) => res.json(configuration()));
    c.api.get('/favicon.ico', (_req, res) => res.status(204).end());
    c.api.get('/__phase5-login', (_req, res) => res.type('html').send(loginHtml()));
    c.api.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.setHeader('Content-Security-Policy', doc.policy); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(doc.html); });
    c.api.use(express.static(path.join(ROOT, 'public')));
}
async function idle(page) { await page.waitForFunction(() => window.projectsViewsController?.getState()?.response && document.getElementById('projects-view-status')?.textContent === '', null, { timeout: 30000 }); }
async function chooseProject(page, id = PROJECT) {
    // An earlier suite may leave an inactive default project. The picker is
    // outside its workspace; select our fixture after Access finishes loading.
    await page.waitForFunction(id => {
        const picker = document.getElementById('projects-board-project-select');
        const access = document.getElementById('btn-projects-access-refresh');
        return document.getElementById('crm-loading')?.style.display === 'none'
            && window.projectsViewsController && picker && !picker.disabled && access && !access.disabled
            && Array.from(picker.options).some(option => option.value === id);
    }, id);
    await page.locator('#projects-board-project-select').selectOption(id);
    await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id, id);
    await page.waitForSelector('#projects-board-workspace:not([hidden])'); await idle(page);
}
async function open(page, url, role = 'owner') { await page.goto(`${url}/__phase5-login?email=${encodeURIComponent(h.USERS[role])}`, { waitUntil: 'domcontentloaded' }); await page.waitForURL(/crm-admin.html#projects$/); await chooseProject(page); }

async function boardIdle(page) {
    await page.waitForFunction(() => document.querySelector('#projects-board-workspace:not([hidden])') && document.getElementById('projects-board-section')?.getAttribute('aria-busy') === 'false');
}
async function selectTask(page, id) {
    const row = page.locator(`[data-row-kind="task"][data-task-id="${id}"]`);
    await row.focus(); await row.press('Enter');
    await page.waitForFunction(id => window.projectsDiscussionController.getState().selection?.taskId === id && !document.getElementById('projects-board-discussion-input').disabled, id);
}
async function saveColumn(page) {
    const response = page.waitForResponse(r => /\/columns(?:\/[^/]+)?$/.test(new URL(r.url()).pathname) && ['PATCH','POST'].includes(r.request().method()));
    await page.locator('#btn-projects-board-save-column').click();
    assert.strictEqual((await response).status(), 200);
    await page.locator('#projects-board-column-form').waitFor({state:'hidden'});
}
const activeGates = [];
const routeFailures = [];
const activeRoutes = [];
function deferred() { let resolve,reject; const promise = new Promise((r,j) => {resolve=r;reject=j;}); promise.catch(()=>{});const gate = { promise, resolve, reject }; activeGates.push(gate); return gate; }
async function bounded(promise,label,ms=45000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(`Timed out: ${label}; cases=${result.cases.length}; routes=${routeFailures.map(e=>e.message).join(';')}`)),ms))]);}finally{clearTimeout(timer);}}
function checkpoint(name){result.cases.push(name);process.stdout.write(`PASS ${name}\n`);fs.writeFileSync(path.join(ARTIFACTS,'result.json'),JSON.stringify(result,null,2));}
async function holdResponse(page,pattern,predicate,label){
    const arrived=deferred(),release=deferred(),fulfilled=deferred();let intercepted=false;
    const handler=async route=>{try{if(intercepted||!predicate(route.request())){await route.continue();return;}intercepted=true;const response=await route.fetch();arrived.resolve(response);await release.promise;await route.fulfill({response});fulfilled.resolve();}catch(error){routeFailures.push(error);arrived.reject(error);fulfilled.reject(error);}};
    await page.route(pattern,handler);
    const held={release,fulfilled,wait:()=>bounded(arrived.promise,`${label} arrived`),async finish(){release.resolve();await bounded(fulfilled.promise,`${label} fulfilled`);await page.unroute(pattern,handler);}};activeRoutes.push(held);return held;
}
function field(page, taskId, kind) { return page.locator(`[data-row-kind="task"][data-task-id="${taskId}"] .crm-board-field[data-field-kind="${kind}"]`); }
async function saveField(page, taskId, kind, value) {
    const response = page.waitForResponse(r => r.url().endsWith(`/tasks/${taskId}`) && r.request().method() === 'PATCH');
    const control = field(page, taskId, kind);
    if (await control.evaluate(el => el.tagName === 'SELECT')) await control.selectOption(value);
    else { await control.fill(value); await control.press('Tab'); }
    assert.strictEqual((await response).status(), 200); await boardIdle(page);
}
async function waitField(page, taskId, kind, value) { await page.waitForFunction(({taskId,kind,value}) => document.querySelector(`[data-row-kind="task"][data-task-id="${taskId}"] .crm-board-field[data-field-kind="${kind}"]`)?.value === value, {taskId,kind,value}, {timeout:30000}); }
function instrumentTaskQueries(c){
    const original=c.db.runTransaction;const reads=[];
    c.db.runTransaction=function(work,options){return original.call(this,transaction=>work(new Proxy(transaction,{get(target,key){if(key==='get')return async(reference,...args)=>{const snapshot=await target.get(reference,...args);if(reference._queryOptions?.collectionId==='tasks'||reference.path?.endsWith('/tasks'))reads.push({path:reference.path||reference._queryOptions?.parentPath?.toString(),documents:snapshot.docs?.length||0,at:Date.now()});return snapshot;};const value=target[key];return typeof value==='function'?value.bind(target):value;}})),options);};
    return{reads,stop(){c.db.runTransaction=original;}};
}
async function main() {
    h.assertDedicatedEmulators(); fs.readFileSync('C:/Cursor AI/.local/browser-test-credentials.md','utf8');
    fs.mkdirSync(ARTIFACTS,{recursive:true});result.projectId=PROJECT;
    const c=await h.bootPhase5(PROJECT);let browser;
    try {
        for(const role of ['owner','editor','viewer'])await c.db.collection('users').doc(c.uids[role]).update({isAdmin:true});
        await c.configure();await h.task(c,'t',{title:'Initial task'});await h.task(c,'parent',{title:'Parent',index:1});
        await h.createTask(c,'child',{title:'Child',parentTaskId:'parent'});
        await h.task(c,'deep-0',{title:'Deep 0',sectionId:'s2'});
        for(let depth=1;depth<=21;depth++)await h.createTask(c,`deep-${depth}`,{title:`Deep ${depth}`,parentTaskId:`deep-${depth-1}`});
        for(let i=0;i<65;i++)h.expectStatus(await c.send('/tasks/t/discussion/messages',{operationId:`${PROJECT}-seed-${i}`,messageId:`m${String(i).padStart(3,'0')}`,body:`Older update ${i}`},'editor','POST'),200);
        await mountShell(c);const url=`http://127.0.0.1:${c.server.address().port}`;
        browser=await chromium.launch({channel:'chrome',headless:true});
        const owner=await(await browser.newContext({viewport:{width:1800,height:1100}})).newPage();
        const editor=await(await browser.newContext({viewport:{width:1800,height:1100}})).newPage();
        for(const [name,page] of [['owner',owner],['editor',editor]]){page.on('pageerror',error=>result.pageErrors.push({name,error:error.message,stack:error.stack}));page.on('response',response=>{if(response.url().includes('/api/projects/'))result.network.push({name,method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()});});}
        await open(editor,url,'editor');await editor.locator('[data-view="board"]').click();await boardIdle(editor);
        const initialHold=await holdResponse(owner,`**/api/projects/${PROJECT}/tasks?*`,()=>true,'initial snapshot');
        const opening=open(owner,url);opening.catch(()=>{});await initialHold.wait();
        await saveField(editor,'t','title','During initial load');await initialHold.finish();await bounded(opening,'open owner');
        await owner.locator('[data-view="board"]').click();await boardIdle(owner);await waitField(owner,'t','title','During initial load');
        checkpoint('Actual delayed initial snapshot catches a concurrent Chrome session edit after head handshake');
        const requests=[];const watch=request=>{if(request.url().includes(`/api/projects/${PROJECT}/`))requests.push(new URL(request.url()).pathname);};owner.on('request',watch);
        await saveField(editor,'t','title','Remote title');await waitField(owner,'t','title','Remote title');
        await saveField(editor,'t','dueDate','2026-09-24');await waitField(owner,'t','dueDate','2026-09-24');
        const ownerControl=field(editor,'t','ownerUid');assert.equal(await ownerControl.count(),1);await saveField(editor,'t','ownerUid',c.uids.editor);await waitField(owner,'t','ownerUid',c.uids.editor);
        assert.ok(!requests.some(p=>p.endsWith('/tasks')||p.endsWith('/views')),'ordinary remote Board fields avoid collection snapshot requests');
        checkpoint('Remote title/date/assignment merge automatically with zero Board task enumeration');
        const branchHold=await holdResponse(owner,`**/api/projects/${PROJECT}/tasks?*`,request=>JSON.parse(new URL(request.url()).searchParams.get('filters')||'{}').parentTaskId==='parent','branch snapshot');
        await owner.locator('[data-task-id="parent"] [data-action="toggle-task"]').click();await branchHold.wait();
        await editor.locator('[data-task-id="parent"] [data-action="toggle-task"]').click();await editor.waitForSelector('[data-task-id="child"][data-row-kind="task"]');await saveField(editor,'child','title','Changed during branch load');await branchHold.finish();await waitField(owner,'child','title','Changed during branch load');
        checkpoint('Delayed branch snapshot catches up a newer real Chrome task edit without losing the event');
        const draft=field(owner,'t','title');await draft.fill('Unsent local draft');await draft.evaluate(el=>el.setSelectionRange(3,9));
        const viewportBefore=await owner.locator('#projects-board-scroll').evaluate(el=>el.scrollTop);
        const remoteDraftRevision=owner.waitForResponse(async r=>r.url().endsWith('/changes/hydrate')&&r.request().method()==='POST'&&(await r.json()).tasks?.some(task=>task.title==='Concurrent server value'));
        await saveField(editor,'t','title','Concurrent server value');
        await remoteDraftRevision;await owner.waitForFunction(()=>window.projectsRemoteObserver.getState().queuedPoll===false);
        assert.equal(await draft.inputValue(),'Unsent local draft');assert.deepEqual(await draft.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,9]);
        const rejected=owner.waitForResponse(r=>r.url().endsWith('/tasks/t')&&r.request().method()==='PATCH');await draft.press('Tab');assert.equal((await rejected).status(),409);assert.equal(await draft.inputValue(),'Unsent local draft');
        const reviewHold=await holdResponse(owner,`**/api/projects/${PROJECT}/tasks/t`,request=>request.method()==='GET','review GET');
        const dialogCheck=owner.waitForEvent('dialog').then(async dialog=>{const message=dialog.message();await dialog.accept();assert.match(message,/Newer during review/);});dialogCheck.catch(()=>{});
        const saved=owner.waitForResponse(r=>r.url().endsWith('/tasks/t')&&r.request().method()==='PATCH');saved.catch(()=>{});await owner.locator('[data-remote-conflict-review="t"]').click();await reviewHold.wait();
        const newerReview=owner.waitForResponse(async r=>r.url().endsWith('/changes/hydrate')&&(await r.json()).tasks?.some(task=>task.title==='Newer during review'));await saveField(editor,'t','title','Newer during review');await newerReview;await owner.waitForFunction(()=>!window.projectsRemoteObserver.getState().queuedPoll);await reviewHold.finish();assert.equal((await saved).status(),200);await dialogCheck;await waitField(editor,'t','title','Unsent local draft');
        assert.equal(await owner.locator('#projects-board-scroll').evaluate(el=>el.scrollTop),viewportBefore);
        checkpoint('Frozen first-input revision conflicts, retains text/caret/scroll and explicit reviewed retry saves');
        const ackHold=await holdResponse(owner,`**/api/projects/${PROJECT}/tasks/t`,request=>request.method()==='PATCH','old PATCH acknowledgement');
        const lateSave=saveField(owner,'t','title','Earlier local acknowledgement');lateSave.catch(()=>{});await ackHold.wait();await waitField(editor,'t','title','Earlier local acknowledgement');
        const latestObserved=owner.waitForResponse(async r=>r.url().endsWith('/changes/hydrate')&&(await r.json()).tasks?.some(task=>task.title==='Newest remote revision'));await saveField(editor,'t','title','Newest remote revision');await latestObserved;await owner.waitForFunction(()=>!window.projectsRemoteObserver.getState().queuedPoll);await ackHold.finish();await lateSave;await waitField(owner,'t','title','Newest remote revision');
        checkpoint('A delayed older local PATCH acknowledgement cannot replace an already observed newer revision');
        const rollbackDraft=field(owner,'t','title');await rollbackDraft.fill('Retained failed draft');
        await saveField(editor,'t','title','Server before rejected patch');
        const failureHold=await holdResponse(owner,`**/api/projects/${PROJECT}/tasks/t`,request=>request.method()==='PATCH','genuine failed PATCH');
        const failedResponse=owner.waitForResponse(r=>r.url().endsWith('/tasks/t')&&r.request().method()==='PATCH');failedResponse.catch(()=>{});await rollbackDraft.press('Tab');const rejectedResponse=await failureHold.wait();assert.equal(rejectedResponse.status(),409);
        const newestAfterFailure=owner.waitForResponse(async r=>r.url().endsWith('/changes/hydrate')&&(await r.json()).tasks?.some(task=>task.title==='Newer while failure held'));await saveField(editor,'t','title','Newer while failure held');await newestAfterFailure;await owner.waitForFunction(()=>!window.projectsRemoteObserver.getState().queuedPoll);await failureHold.finish();assert.equal((await failedResponse).status(),409);assert.equal(await rollbackDraft.inputValue(),'Retained failed draft');
        await selectTask(owner,'t');await owner.waitForFunction(()=>document.getElementById('projects-board-detail-title')?.textContent==='Newer while failure held');
        owner.once('dialog',dialog=>dialog.accept());const retriedFailure=owner.waitForResponse(r=>r.url().endsWith('/tasks/t')&&r.request().method()==='PATCH');await owner.locator('[data-remote-conflict-review="t"]').click();assert.equal((await retriedFailure).status(),200);await waitField(editor,'t','title','Retained failed draft');
        checkpoint('A delayed genuine 409 preserves newer acknowledged server state and the failed draft can be reviewed and saved');
        // Clear task selection through the visible other row before testing
        // a new discussion snapshot; no controller stub or manual refresh.
        await selectTask(owner,'parent');
        await selectTask(editor,'t');await editor.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length>=50);
        const discussionHold=await holdResponse(owner,`**/api/projects/${PROJECT}/tasks/t/discussion?*`,()=>true,'discussion snapshot');
        await selectTask(owner,'t');await discussionHold.wait();await editor.locator('#projects-board-discussion-input').fill('During discussion snapshot');const discussionPost=editor.waitForResponse(r=>r.url().endsWith('/discussion/messages')&&r.request().method()==='POST');await editor.locator('#btn-projects-board-discussion-send').click();assert.equal((await discussionPost).status(),200);await discussionHold.finish();
        await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.some(m=>m.body==='During discussion snapshot'));
        await owner.locator('#btn-projects-board-discussion-more').click();await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length===66);
        const composer=owner.locator('#projects-board-discussion-input');await composer.fill('Unsent reply draft');await composer.evaluate(el=>el.setSelectionRange(2,8));
        await selectTask(editor,'t');await editor.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length>=50);await editor.locator('#btn-projects-board-discussion-more').click();await editor.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length===66);
        editor.once('dialog',dialog=>dialog.accept('Edited oldest remotely'));const edited=editor.waitForResponse(r=>r.url().endsWith('/messages/m000')&&r.request().method()==='PATCH');await editor.locator('[data-discussion-edit="m000"]').click();assert.equal((await edited).status(),200);
        await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.find(m=>m.id==='m000')?.body==='Edited oldest remotely');
        assert.equal(await owner.evaluate(()=>window.projectsDiscussionController.getState().messages.length),66);assert.equal(await composer.inputValue(),'Unsent reply draft');assert.deepEqual(await composer.evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,8]);
        await editor.locator('#projects-board-discussion-input').fill('Remote newest message');await editor.locator('#btn-projects-board-discussion-send').click();await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.some(m=>m.body==='Remote newest message'));
        assert.equal(await owner.evaluate(()=>window.projectsDiscussionController.getState().messages.some(m=>m.id==='m000')),true);
        checkpoint('Two Chrome sessions merge older loaded edits and new messages while retaining composer/caret and older pages');
        // API mutations below still use canonical authenticated handlers; owner
        // Chrome remains an automatic observer and never refreshes manually.
        const oldMessage=(await c.projectRef.collection('discussions').doc('m000').get()).data();
        h.expectStatus(await c.send('/tasks/t/discussion/messages/m000/moderate',{operationId:`${PROJECT}-hide`,expectedRevision:oldMessage.revision,action:'hide',reason:'Remote acceptance'},'owner','POST'),200);
        await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.find(m=>m.id==='m000')?.moderationState==='hidden');
        const schema=(await c.revision()).schemaRevision;h.expectStatus(await c.send('/columns',{operationId:`${PROJECT}-column`,columnId:'remote-text',type:'text',label:'Remote column',expectedSchemaRevision:schema},'owner','POST'),200);
        await owner.waitForSelector('[data-column-id="remote-text"]');assert.equal(await composer.inputValue(),'Unsent reply draft');
        const structure=(await c.revision()).structureRevision;const child=await c.data('child');h.expectStatus(await c.send('/tasks/child/move',{operationId:`${PROJECT}-move`,expectedRevision:child.revision,expectedStructureRevision:structure,parentTaskId:'t',index:0},'owner','POST'),200);
        await owner.waitForFunction(()=>document.querySelector('[data-task-id="t"] [data-action="toggle-task"]')?.getAttribute('aria-expanded')!==null);
        await owner.locator('[data-task-id="t"] [data-action="toggle-task"]').click();await owner.waitForSelector('[data-task-id="child"][data-row-kind="task"]');
        checkpoint('Remote moderation, schema addition and move invalidate authorized loaded branches');
        await selectTask(owner,'t');await owner.waitForFunction(()=>document.getElementById('projects-task-derived')?.textContent.includes('0/1'));
        // Commands may themselves enumerate the graph. Begin instrumentation
        // after their response so this window measures observer reads only.
        const aggregateHold=await holdResponse(owner,`**/api/projects/${PROJECT}/changes*`,request=>request.method()==='GET','aggregate poll');
        await aggregateHold.wait();const currentChild=await c.data('child');h.expectStatus(await c.send('/tasks/child',{operationId:`${PROJECT}-aggregate`,expectedRevision:currentChild.revision,status:'done',startDate:'2026-09-20',dueDate:'2026-09-25'},'editor','PATCH'),200);
        const aggregateReads=instrumentTaskQueries(c);
        try{await aggregateHold.finish();await owner.waitForFunction(()=>{const text=document.getElementById('projects-task-derived')?.textContent||'';return text.includes('1/1 complete')&&text.includes('2026-09-20')&&text.includes('2026-09-25');});await owner.waitForFunction(()=>!window.projectsRemoteObserver.getState().queuedPoll);assert.ok(aggregateReads.reads.length>0);assert.ok(aggregateReads.reads.length<=8,`selected aggregate query count bounded: ${JSON.stringify(aggregateReads.reads)}`);result.persisted.aggregateQueryReads=aggregateReads.reads.slice();}finally{aggregateReads.stop();}
        await editor.waitForFunction(()=>document.getElementById('projects-task-derived')?.textContent.includes('1/1 complete'));await editor.waitForFunction(()=>!window.projectsRemoteObserver.getState().queuedPoll);
        const emptyReads=instrumentTaskQueries(c);try{await owner.waitForResponse(async response=>response.url().includes(`/api/projects/${PROJECT}/changes?`)&&response.status()===200&&(await response.json()).changes?.length===0);await owner.waitForFunction(()=>!window.projectsRemoteObserver.getState().queuedPoll);assert.equal(emptyReads.reads.length,0);}finally{emptyReads.stop();}
        checkpoint('Selected ancestor derived completion/date span refreshes automatically with bounded actual collection reads; empty polls read none');
        await owner.locator('#projects-board-scroll').evaluate(el=>{el.scrollTop=0;});
        for(let depth=0;depth<=20;depth++){const toggle=owner.locator(`[data-task-id="deep-${depth}"] [data-action="toggle-task"]`);await toggle.scrollIntoViewIfNeeded();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await owner.waitForSelector(`[data-task-id="deep-${depth+1}"][data-row-kind="task"]`);}
        await selectTask(owner,'deep-21');await owner.waitForFunction(()=>document.getElementById('projects-board-detail-body')?.textContent.includes('Deep 20'));
        const deep=await c.data('deep-21');h.expectStatus(await c.send('/tasks/deep-21/move',{operationId:`${PROJECT}-deep-move`,expectedRevision:deep.revision,expectedStructureRevision:(await c.revision()).structureRevision,parentTaskId:'deep-10',index:1},'owner','POST'),200);
        await owner.waitForFunction(()=>{const text=document.getElementById('projects-board-detail-body')?.textContent||'';return text.includes('Deep 10')&&!text.includes('Deep 20');});assert.equal((await c.data('deep-21')).parentTaskId,'deep-10');
        const deepAncestor=await c.data('deep-10');h.expectStatus(await c.send('/tasks/deep-10/archive',{operationId:`${PROJECT}-deep-archive`,expectedRevision:deepAncestor.revision,expectedStructureRevision:(await c.revision()).structureRevision},'owner','POST'),200);
        await owner.waitForFunction(()=>document.getElementById('projects-board-detail').hidden&&!document.querySelector('[data-task-id="deep-21"][data-row-kind="task"]'));assert.equal((await c.data('deep-10')).lifecycle,'archived');
        await owner.locator('#projects-board-scroll').evaluate(el=>{el.scrollTop=0;});await owner.waitForSelector('[data-task-id="t"][data-row-kind="task"]');await selectTask(owner,'t');assert.equal(await composer.inputValue(),'Unsent reply draft');
        checkpoint('A task loaded at depth 21 moves remotely and ancestor archive removes its loaded descendants while retaining an unrelated composer draft');
        await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length>=50);
        if(await owner.evaluate(()=>window.projectsDiscussionController.getState().messages.length)<67){await owner.locator('#btn-projects-board-discussion-more').click();await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length===67);}
        for(let i=0;i<100;i++)h.expectStatus(await c.send('/tasks/t/discussion/messages',{operationId:`${PROJECT}-repair-seed-${i}`,messageId:`repair-${String(i).padStart(3,'0')}`,body:`Repair update ${i}`},'editor','POST'),200);
        await owner.waitForFunction(()=>window.projectsDiscussionController.getState().messages.length===167,null,{timeout:60000});
        await owner.waitForResponse(async response=>response.url().includes(`/api/projects/${PROJECT}/changes?`)&&response.status()===200&&(await response.json()).changes?.length===0);
        let repairRequests=0;const ownerRepairHold=await holdResponse(owner,`**/api/projects/${PROJECT}/changes/hydrate`,request=>request.method()==='POST'&&JSON.parse(request.postData()).messageIds?.length>0&&++repairRequests===4,'fourth Owner repair batch');
        const ownerMember=c.db.collection('crmProjectMembers').doc(require('../../../functions/src/crm/projects/access-service').memberDocumentId(PROJECT,c.uids.owner));const savedOwnerMember=(await ownerMember.get()).data();const membershipRevision=(await c.revision()).membershipRevision;
        try{
            await c.projectRef.update({membershipRevision:membershipRevision+1});await ownerRepairHold.wait();
            const viewerRepairHold=await holdResponse(owner,`**/api/projects/${PROJECT}/changes/hydrate`,request=>request.method()==='POST'&&JSON.parse(request.postData()).messageIds?.length>0,'first Viewer repair batch');
            await ownerMember.update({role:'Viewer'});await ownerRepairHold.finish();await viewerRepairHold.wait();
            const protectedState=await owner.evaluate(()=>({role:window.projectsDiscussionController.getState().selection.role,messages:window.projectsDiscussionController.getState().messages,signature:window.projectsRemoteObserver.getState().signature,body:document.getElementById('projects-board-discussion-list').textContent}));
            assert.equal(protectedState.role,'Viewer');assert.equal(protectedState.messages.length,167);assert.equal(protectedState.messages.find(message=>message.id==='m000').body,null);assert.ok(!protectedState.body.includes('Edited oldest remotely'));assert.ok(!protectedState.signature.includes('Viewer'),'authority repair is not acknowledged before hydration completes');
            await viewerRepairHold.finish();await owner.waitForFunction(()=>window.projectsRemoteObserver.getState().signature.includes('Viewer')&&!window.projectsRemoteObserver.getState().queuedPoll);assert.equal(await owner.evaluate(()=>window.projectsDiscussionController.getState().messages.find(message=>message.id==='m000').body),null);assert.equal(await owner.evaluate(()=>window.projectsDiscussionController.getState().messages.length),167);
        }finally{await ownerMember.set(savedOwnerMember);}
        await owner.waitForFunction(()=>window.projectsDiscussionController.getState().selection?.role==='Owner'&&window.projectsRemoteObserver.getState().signature.includes('Owner'));
        checkpoint('A real 167-message partial repair downgrades Owner to Viewer without re-exposing moderated older content or dropping older pages');
        const member=c.db.collection('crmProjectMembers').doc(require('../../../functions/src/crm/projects/access-service').memberDocumentId(PROJECT,c.uids.editor));await member.update({role:'Viewer'});await editor.waitForFunction(()=>document.getElementById('projects-board-discussion-input').disabled);
        await member.update({active:false});await editor.waitForFunction(()=>window.projectsRemoteObserver.getState().projectId==='' && !document.querySelector('[data-row-kind="task"]'));
        checkpoint('Empty-feed role downgrade and revocation clear/disable content and stop observation');
        owner.off('request',watch);result.persisted.task=await c.data('t');result.persisted.child=await c.data('child');result.persisted.messageCount=(await c.projectRef.collection('discussions').get()).size;
        const shot=path.join(ARTIFACTS,'remote-final.png');await owner.screenshot({path:shot,fullPage:true});result.screenshots.push(shot);assert.deepEqual(result.pageErrors,[]);assert.deepEqual(routeFailures,[]);
    }catch(error){result.failure=error.stack;throw error;}finally{activeGates.forEach(gate=>gate.resolve());await Promise.allSettled(activeRoutes.map(held=>bounded(held.fulfilled.promise,'cleanup held route',5000)));result.routeFailures=routeFailures.map(error=>error.stack);result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(ARTIFACTS,'result.json'),JSON.stringify(result,null,2));const cleanup=await Promise.allSettled([browser?.close()]);c.server.closeAllConnections?.();cleanup.push(...await Promise.allSettled([c.close()]));const failures=cleanup.filter(entry=>entry.status==='rejected');if(failures.length){result.cleanupFailures=failures.map(entry=>entry.reason?.stack||String(entry.reason));fs.writeFileSync(path.join(ARTIFACTS,'result.json'),JSON.stringify(result,null,2));if(!result.failure)throw failures[0].reason;}}
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exitCode=1;});
