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
const PROJECT = `nonvoice-board-${Date.now()}`;
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/nonvoice-board-discussion-browser');
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
async function main() {
    h.assertDedicatedEmulators(); fs.readFileSync('C:/Cursor AI/.local/browser-test-credentials.md', 'utf8');
    fs.mkdirSync(ARTIFACTS,{recursive:true});
    result.projectId = PROJECT;
    const c = await h.bootPhase5(PROJECT); let browser;
    try {
        for (const role of ['owner','editor','viewer']) await c.db.collection('users').doc(c.uids[role]).update({isAdmin:true});
        await c.configure();
        await h.createColumn(c,'choice',{type:'dropdown',label:'Choice',options:[{key:'red',label:'Red'},{key:'blue',label:'Blue'}]});
        await h.createColumn(c,'stage',{type:'status',label:'Stage',expectedSchemaRevision:1});
        await h.task(c,'first',{title:'First root',values:{choice:'red'}});
        await h.task(c,'second',{title:'Second root',index:1,values:{choice:'blue'}});
        let parent='first';
        for(let i=0;i<4;i++) { const id=`depth-${i}`; await h.createTask(c,id,{parentTaskId:parent,title:`Depth ${i}`,values:{choice:i%2?'blue':'red'}}); parent=id; }
        for(let i=0;i<66;i++) h.expectStatus(await c.send('/tasks/first/discussion/messages',{operationId:`${PROJECT}-seed-message-${i}`,messageId:`message-${i}`,body:`Seed update ${i}`},'editor','POST'),200);
        await mountShell(c); const url=`http://127.0.0.1:${c.server.address().port}`;
        browser=await chromium.launch({channel:'chrome',headless:true});
        const ownerContext=await browser.newContext({viewport:{width:1800,height:1100}});
        const page=await ownerContext.newPage(); page.on('pageerror',e=>result.pageErrors.push(e.message));
        page.on('console',message=>{if(['error','warning'].includes(message.type()))result.console.push({type:message.type(),text:message.text(),location:message.location()});});
        page.on('response',response=>{if(response.url().includes('/api/projects/'))result.network.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()});});
        await open(page,url); await page.locator('[data-view="board"]').click(); await boardIdle(page);
        const mutations=[]; page.on('request',r=>{if(r.url().includes('/api/projects/')&&['PATCH','POST','DELETE'].includes(r.method()))mutations.push(r.url());});
        for(const [role,current] of [['owner',page],['viewer',await (await browser.newContext({viewport:{width:1800,height:1100}})).newPage()]]) {
            if(role==='viewer'){await open(current,url,role);await current.locator('[data-view="board"]').click();await boardIdle(current);}
            const requests=[]; const listener=r=>{if(r.url().includes('/api/projects/')&&['PATCH','POST','DELETE'].includes(r.method()))requests.push(r.url());};current.on('request',listener);
            const row=current.locator('[data-row-kind="task"][data-task-id="second"]');
            await row.focus(); await current.keyboard.press('Tab');
            assert.strictEqual(await row.evaluate(el=>document.activeElement===el),false,`${role} Tab leaves row focus`);
            await row.focus(); await current.keyboard.press('Shift+Tab');
            assert.strictEqual(await row.evaluate(el=>document.activeElement===el),false,`${role} ShiftTab leaves row focus`);
            await current.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.deepStrictEqual(requests,[],`${role} native Tab never mutates API`); current.off('request',listener);
            assert.strictEqual((await c.data('second')).parentTaskId,null);
            if(role==='viewer')await current.context().close();
        }
        result.cases.push('Owner and Viewer actual Tab and ShiftTab focus exit with zero API mutations');
        const row=page.locator('[data-task-id="second"][data-row-kind="task"]');
        const indent = page.waitForResponse(r=>r.url().endsWith('/tasks/second/move')&&r.request().method()==='POST');
        await row.focus(); await row.press('Alt+ArrowRight');
        assert.strictEqual((await indent).status(),200); await boardIdle(page); await page.locator('[data-task-id=second].is-pending').waitFor({state:'detached'});
        assert.strictEqual((await c.data('second')).parentTaskId,'first');
        const outdent = page.waitForResponse(r=>r.url().endsWith('/tasks/second/move')&&r.request().method()==='POST');
        await page.locator('[data-task-id="second"][data-row-kind="task"]').focus();await page.keyboard.press('Alt+ArrowLeft');
        assert.strictEqual((await outdent).status(),200); await boardIdle(page); await page.locator('[data-task-id=second].is-pending').waitFor({state:'detached'});
        assert.strictEqual((await c.data('second')).parentTaskId,null);result.cases.push('Alt arrows persist indent and outdent');
        for(const id of ['first','depth-0','depth-1','depth-2']) {
            const button=page.locator(`[data-task-id="${id}"] [data-action="toggle-task"]`);
            if(await button.getAttribute('aria-expanded')!=='true')await button.click();
            const child=id==='first'?'depth-0':`depth-${Number(id.slice(-1))+1}`;
            await page.locator(`[data-task-id="${child}"]`).waitFor();
        }
        const before={}; for(const id of ['first','second','depth-0','depth-1','depth-2','depth-3'])before[id]=(await c.data(id)).values;
        await page.locator('[data-action="edit-column"][data-column-id="choice"]').click();
        await page.locator('#projects-board-column-label').fill('Conflict draft retained');
        const initialColumn=(await c.projectRef.collection('columns').doc('choice').get()).data();
        h.expectStatus(await c.send('/columns/choice',{operationId:`${PROJECT}-external-column-edit`,expectedRevision:initialColumn.revision,expectedSchemaRevision:(await c.revision()).schemaRevision,label:'External choice label'}),200);
        const conflict=page.waitForResponse(r=>r.url().endsWith('/columns/choice')&&r.request().method()==='PATCH');
        await page.locator('#btn-projects-board-save-column').click();assert.strictEqual((await conflict).status(),409);
        await page.waitForFunction(()=>!document.getElementById('btn-projects-board-save-column').disabled);
        assert.strictEqual(await page.locator('#projects-board-column-label').inputValue(),'Conflict draft retained');
        await page.locator('#btn-projects-board-cancel-column').click();await page.locator('#projects-board-column-form').waitFor({state:'hidden'});
        await page.locator('#btn-projects-board-refresh').click();await boardIdle(page);
        await page.locator('[data-action="edit-column"][data-column-id="choice"]').click();
        assert.strictEqual(await page.locator('#projects-board-column-label').inputValue(),'External choice label');
        result.cases.push('Real409 schema conflict retains editor draft; cancel and refresh load authoritative label');
        assert.strictEqual(await page.locator('#projects-board-column-type').isDisabled(),true);
        await page.locator('#projects-board-column-label').fill('Renamed choice');
        await page.locator('[data-option-key="red"]').fill('Crimson');
        await page.locator('[data-option-key="blue"]').locator('..').locator('[data-remove-option]').click();
        await page.locator('[data-add-option]').click();
        const fresh=page.locator('[data-option-key]').last();const newKey=await fresh.getAttribute('data-option-key');
        assert.ok(!['red','blue'].includes(newKey));await fresh.fill('Green');await saveColumn(page);
        const column=(await c.projectRef.collection('columns').doc('choice').get()).data();
        assert.deepStrictEqual(column.options,[{key:'red',label:'Crimson'},{key:newKey,label:'Green'}]);
        assert.strictEqual(column.label,'Renamed choice');
        for(const [id,values] of Object.entries(before))assert.deepStrictEqual((await c.data(id)).values,values);
        assert.match(await page.locator('[data-task-id="second"] select[data-column-id="choice"] option:checked').textContent(),/unavailable/);
        await page.locator('[data-action="edit-column"][data-column-id="stage"]').click();
        for(const [key,label] of Object.entries({not_started:'Queued',in_progress:'Active',blocked:'Waiting',done:'Complete'}))await page.locator(`[data-status-key="${key}"]`).fill(label);
        await saveColumn(page);
        assert.deepStrictEqual((await c.projectRef.collection('columns').doc('stage').get()).data().statusLabels,{not_started:'Queued',in_progress:'Active',blocked:'Waiting',done:'Complete'});
        await page.locator('[data-action="edit-column"][data-column-id="choice"]').click();
        const archive=page.waitForResponse(r=>r.url().endsWith('/columns/choice/archive'));await page.locator('[data-archive-column]').click();assert.strictEqual((await archive).status(),200);
        await page.locator('[data-action="edit-column"][data-column-id="choice"]').waitFor({state:'detached'});
        for(const [id,values] of Object.entries(before))assert.deepStrictEqual((await c.data(id)).values,values);
        assert.strictEqual((await c.projectRef.collection('columns').doc('choice').get()).data().lifecycle,'archived');
        result.cases.push('Stable dropdown keys and deep task values survive rename/remove/add/archive; four custom status labels persist');
        await selectTask(page,'first');await page.locator('[data-discussion-reply="message-65"]').waitFor();
        const input=page.locator('#projects-board-discussion-input');await input.fill('Newest browser update beyond sixty five');
        await page.locator('#btn-projects-board-discussion-send').click();
        await page.getByText('Newest browser update beyond sixty five',{exact:true}).waitFor();
        await page.locator('[data-discussion-reply="message-65"]').click();await input.fill('Retained reply draft');
        await selectTask(page,'second');await selectTask(page,'first');assert.strictEqual(await input.inputValue(),'Retained reply draft');
        await page.locator('[data-discussion-cancel-reply]').waitFor();
        const replyResponse=page.waitForResponse(r=>r.url().endsWith('/tasks/first/discussion/messages')&&r.request().method()==='POST');
        await page.locator('#btn-projects-board-discussion-send').click();assert.strictEqual((await replyResponse).status(),200);
        const all=await h.readAllMessages(c,await c.token('owner'),'first');
        assert.ok(all.some(message=>message.body==='Retained reply draft'&&message.parentMessageId==='message-65'));
        result.cases.push('Newest post visible in66+ thread; switched task reply draft retains persisted parent');
        await input.fill('Composer retained during manual refresh');
        const member=await (await browser.newContext({viewport:{width:1800,height:1100}})).newPage();await open(member,url,'editor');await member.locator('[data-view="board"]').click();await boardIdle(member);await selectTask(member,'first');
        await member.locator('#projects-board-discussion-input').fill('Second member live browser post');await member.locator('#btn-projects-board-discussion-send').click();await member.getByText('Second member live browser post',{exact:true}).waitFor();
        const fetches=[];const listener=r=>{if(r.method()==='GET'&&/\/tasks\/first\/discussion(?:\?|$)/.test(r.url()))fetches.push(r.url());};page.on('request',listener);
        try {
            const refreshedDiscussion=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===`/api/projects/${PROJECT}/tasks/first/discussion`,{timeout:30000});
            const settled=await Promise.allSettled([
                refreshedDiscussion,
                Promise.resolve().then(()=>page.locator('#btn-projects-board-refresh').click({timeout:30000}))
            ]);
            const failures=settled.map((entry,index)=>({entry,label:['discussion response','manual refresh click'][index]})).filter(({entry})=>entry.status==='rejected');
            if(failures.length)throw new AggregateError(failures.map(({entry})=>entry.reason),'Manual refresh failed\n'+failures.map(({entry,label})=>`${label}: ${entry.reason?.stack||entry.reason}`).join('\n'));
            const response=settled[0].value;assert.strictEqual(response.status(),200);
            assert.ok((await response.json()).messages.some(message=>message.body==='Second member live browser post'),'Manual refresh response must include the other member post');
            await boardIdle(page);await page.getByText('Second member live browser post',{exact:true}).waitFor();
            assert.strictEqual(await input.inputValue(),'Composer retained during manual refresh');assert.strictEqual(fetches.length,1);
        } finally {page.off('request',listener);}
        result.cases.push('Manual board refresh fetches discussion once, shows second member post and preserves composer');
        await page.screenshot({path:path.join(ARTIFACTS,'board-discussion.png'),fullPage:true});
        result.screenshots.push('board-discussion.png');
        assert.deepStrictEqual(result.pageErrors,[]);result.passed=true;
    } catch(error) {
        result.error=error.stack;
        const failedPage=browser?.contexts()[0]?.pages()[0];
        if(failedPage){await failedPage.screenshot({path:path.join(ARTIFACTS,'failure.png'),fullPage:true}).catch(()=>{});result.screenshots.push('failure.png');}
        throw error;
    } finally {if(browser)await browser.close();await c.close();fs.writeFileSync(path.join(ARTIFACTS,'report.json'),JSON.stringify(result,null,2));}
    console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
