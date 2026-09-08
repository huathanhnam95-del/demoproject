'use strict';
// Chrome-only acceptance: shipped shell, actual Auth/Firestore emulators and
// production notification routes. Held responses retain their original bytes.
// Automation effects are executed with the actual persisted processor. Never run against production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase6-test-helpers');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const ROOT = path.resolve(__dirname, '../../..');
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/phase7-browser');
const report = { cases: [], screenshots: [], network: [], pageErrors: [], console: [], startedAt: new Date().toISOString() };
const releases = new Set();
const endpoint = value => { const [host, port] = value.split(':'); return { host, port: Number(port) }; };
function configuration() { return { success: true, config: { apiKey: 'demo-key', authDomain: 'demo-crm-projects.firebaseapp.com', projectId: 'demo-crm-projects', storageBucket: 'demo-crm-projects.appspot.com', appId: '1:000:web:phase6' }, emulators: { auth: endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST), firestore: endpoint(process.env.FIRESTORE_EMULATOR_HOST), storage: endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST) }, features: { projects: true } }; }
function loginHtml() { return `<!doctype html><meta charset="utf-8"><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>(async()=>{const p=await(await fetch('/api/config')).json();firebase.initializeApp(p.config);firebase.auth().useEmulator('http://'+p.emulators.auth.host+':'+p.emulators.auth.port,{disableWarnings:true});await firebase.auth().signInWithEmailAndPassword(new URLSearchParams(location.search).get('email'),${JSON.stringify(h.PASSWORD)});location.replace('/crm-admin.html#projects')})().catch(e=>document.body.textContent=e.message)</script>`; }
async function mountShell(suite) {
  const authMiddleware = async (req, res, next) => { try { req.user = await suite.auth.verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); next(); } catch (_) { res.status(401).json({ success: false }); } };
  const currentAdmin = async uid => (await suite.db.collection('users').doc(uid).get()).data()?.isAdmin === true;
  const adminMiddleware = async (req, res, next) => { if (await currentAdmin(req.user.uid)) next(); else res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' }); };
  suite.api.use('/api/admin', createCrmRouter({ identity: require('../../../functions/src/studentIdentity'), db: suite.db, authMiddleware, adminMiddleware, resolveAdminStatus: async ({ req }) => ({ isAdmin: await currentAdmin(req.user.uid), uid: req.user.uid }), serverTimestamp: () => new Date() }));
  suite.api.get('/api/config', (_req, res) => res.json(configuration()));
  suite.api.get('/favicon.ico', (_req, res) => res.status(204).end());
  suite.api.get('/__phase7-login', (_req, res) => res.type('html').send(loginHtml()));
  suite.api.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.setHeader('Content-Security-Policy', doc.policy); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(doc.html); });
  suite.api.use(express.static(path.join(ROOT, 'public')));
}
async function responseAction(page, method, pathname, action, status = 200) {
  const pending = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === pathname, { timeout: 30000 });
  // Attach rejection handlers to both promises before either can reject. Wait
  // for both to settle so a failed click cannot run into the next test case.
  const [responseResult, actionResult] = await Promise.allSettled([pending, Promise.resolve().then(action)]);
  if (actionResult.status === 'rejected') throw actionResult.reason;
  if (responseResult.status === 'rejected') throw responseResult.reason;
  const response = responseResult.value; const body = await response.json();
  assert.equal(response.status(), status, `${method} ${pathname}: ${JSON.stringify(body)}`); return body;
}
async function idleBoard(page, projectId) { await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id && document.getElementById('projects-view-status')?.textContent === '', projectId, { timeout: 30000 }); }
async function shellReady(page) {
  await page.waitForFunction(() => {
    const boardPicker = document.getElementById('projects-board-project-select');
    const accessPicker = document.getElementById('projects-project-select');
    const accessRefresh = document.getElementById('btn-projects-access-refresh');
    const boardRefresh = document.getElementById('btn-projects-board-refresh');
    const views = window.projectsViewsController?.getState();
    return document.getElementById('crm-loading')?.style.display === 'none'
      && !!window.projectsAutomationsController && !!accessPicker && !accessPicker.disabled
      && !!accessRefresh && !accessRefresh.disabled && !!boardRefresh && !boardRefresh.disabled
      && !!boardPicker?.value && views?.response?.project?.id === boardPicker.value
      && document.getElementById('projects-view-status')?.textContent === '';
  }, null, { timeout: 30000 });
}
async function chooseProject(page, projectId) {
  // Access rejects selectProject while its initial refresh or member read is
  // pending; the Board picker alone does not reflect that independent lock.
  await shellReady(page);
  await page.locator(`#projects-board-project-select option[value="${projectId}"]`).waitFor({ state: 'attached' });
  await page.locator('#projects-board-project-select').selectOption(projectId);
  await idleBoard(page, projectId);
}

const action = (page, name) => page.locator(`#projects-automations [data-auto-action="${name}"]`);
const state = page => page.evaluate(() => window.projectsAutomationsController.getState());
const field = (page, node, parts) => page.locator(`#projects-automations :is(input,select,textarea)[data-auto-node="${node}"][data-auto-path='${JSON.stringify(parts)}']`);
async function idle(page) { await page.waitForFunction(() => { const s=window.projectsAutomationsController?.getState(); return s?.ready && !s.loading && !s.inFlight; },null,{timeout:30000}); }
async function open(page,url,c) {
  await page.goto(`${url}/__phase7-login?email=${encodeURIComponent(h.USERS.owner)}`,{waitUntil:'domcontentloaded'});
  await page.waitForURL(/crm-admin.html#projects$/); await shellReady(page); await chooseProject(page,c.projectId);
  await page.waitForFunction(() => window.projectsAutomationsController?.getState().ready);
  await page.locator('#btn-projects-automate').click(); await idle(page);
}
async function openRule(page,c,id) {
  await action(page,'manage').click(); await idle(page);
  const button=page.locator(`[data-auto-action="open-rule"][data-rule-id="${id}"]`);
  await responseAction(page,'GET',`/api/projects/${c.projectId}/automations/${id}`,()=>button.click()); await idle(page);
  await page.waitForFunction(id=>window.projectsAutomationsController.getState().rule?.ruleId===id,id);
}
async function sample(page,id='subject') {
  await action(page,'sample-search').click();
  await page.locator('[data-auto-form="task-search"] input').fill('Browser subject');
  await page.locator('[data-auto-form="task-search"] button[type="submit"]').click();
  const projectId=(await state(page)).projectId;
  // Choosing the same sample still performs a fresh authorized task read. The
  // previous sample ID is not evidence that this selection has been accepted.
  await responseAction(page,'GET',`/api/projects/${projectId}/tasks/${id}`,()=>page.locator(`[data-auto-action="choose-task"][data-task-id="${id}"]`).click());
  await page.waitForFunction(id=>{const s=window.projectsAutomationsController.getState();return s.sample?.id===id&&s.search===null;},id);
}
async function preview(page,c,id) {
  const evidence={ruleId:id,startedAt:new Date().toISOString(),before:await state(page)};
  (report.previewAttempts ||= []).push(evidence);
  try {
    const result=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${id}/preview`,()=>action(page,'preview').click());
    evidence.responseAt=new Date().toISOString();evidence.responseVersionId=result.versionId;evidence.afterResponse=await state(page);
    await idle(page);await page.waitForFunction(()=>!!window.projectsAutomationsController.getState().preview);
    evidence.acceptedAt=new Date().toISOString();evidence.accepted=await state(page);return result;
  } catch(error) {evidence.failedAt=new Date().toISOString();evidence.failureState=await state(page);throw error;}
}
async function content(c) {
  const result={};
  for(const name of ['tasks','sections','columns'])result[name]=(await c.projectRef.collection(name).get()).docs.map(d=>({id:d.id,...d.data()}));
  for(const name of ['crmProjectOperations','crmProjectEvents','runs','journals','notifications'])result[name]=await c.rows(name);
  return result;
}
async function held(page,pattern,trigger,change,verify) {
  let release,capture;const gate=new Promise(resolve=>{release=resolve;});const captured=new Promise(resolve=>{capture=resolve;});
  releases.add(release);let deliveryResolve;const delivered=new Promise(resolve=>{deliveryResolve=resolve;});
  const handler=async route=>{try{const response=await route.fetch();capture();await gate;await route.fulfill({response});}catch(error){report.pageErrors.push(`Held response delivery: ${error.message}`);capture();}finally{deliveryResolve();}};
  await page.route(pattern,handler);
  let timer;
  try { await trigger();await Promise.race([captured,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Held response was never captured')),15000);})]);await change();release();await delivered;await page.waitForTimeout(150);await verify(); }
  finally {clearTimeout(timer);release();releases.delete(release);await page.unroute(pattern,handler);}
}
async function shot(page,name) {const file=path.join(ARTIFACTS,`${name}.png`);await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);}
async function main() {
  fs.mkdirSync(ARTIFACTS,{recursive:true});const suite=await h.bootSuite();let browser,page;
  const run=async(name,fn)=>{try{await fn();report.cases.push({name,passed:true});}catch(error){const row={name,passed:false,error:error.stack};report.cases.push(row);if(page&&!page.isClosed()){const stem=`failure-${report.cases.length}`;await Promise.allSettled([shot(page,stem),page.content().then(x=>fs.writeFileSync(path.join(ARTIFACTS,`${stem}.html`),x)),state(page).then(x=>fs.writeFileSync(path.join(ARTIFACTS,`${stem}.json`),JSON.stringify(x,null,2)))]);}}finally{fs.writeFileSync(path.join(ARTIFACTS,'report.json'),JSON.stringify(report,null,2));}};
  try {
    suite.setTime(new Date());await mountShell(suite);
    const c=await h.project(suite,'phase7-browser-main'),second=await h.project(suite,'phase7-browser-second');
    for(const role of ['owner','viewer'])await suite.db.collection('users').doc(c.uids[role]).update({isAdmin:true});
    h.expectStatus(await c.send(`/members/${c.uids.editor}`,{role:'Owner'},'owner','PATCH'),200);
    const prefs=h.expectStatus(await suite.global('/notification-preferences','editor'),200);h.expectStatus(await suite.global('/notification-preferences','editor','PATCH',{expectedRevision:prefs.revision,muted:[]}),200);
    await c.task('subject',{title:'Browser subject',ownerUid:c.uids.editor});await c.task('repair-target',{title:'Browser repair target'});await second.task('subject',{title:'Second Browser subject'});
    const seedRule=async(title,definition)=>h.expectStatus(await c.send('/automations',{operationId:c.op('seed'),title,definition}),200);
    const complex=await seedRule('Browser nested representation',h.definition([{nodeId:'branch',type:'if',condition:{field:'status',operator:'equals',value:'done'},then:[h.notify('nested','Nested message')],else:[{nodeId:'wait',type:'delay',payload:{durationMs:60000}},h.notify('later','Later message')]}]));
    const repair=await seedRule('Browser repair reference',h.definition([{nodeId:'repair',type:'set_field',payload:{target:{taskId:'repair-target'},patch:{status:'done'}}}]));
    const scoped=await seedRule('Browser scope sentinel',h.definition([h.notify('scope','Private scope sentinel')]));
    browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1100}});
    page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.console.push(m.text());});page.on('response',r=>{if(r.url().includes('/api/projects/'))report.network.push({url:r.url(),method:r.request().method(),status:r.status()});});
    const url=`http://127.0.0.1:${suite.server.address().port}`;
    await run('real create, preview without writes, activation, persisted effect and run/version inspection',async()=>{
      await open(page,url,c);await action(page,'create').click();await page.locator('#auto-title').fill('Browser created automation');
      await page.locator('[data-auto-kind="trigger-kind"]').selectOption('status_changed');await field(page,'',['trigger','from']).selectOption('not_started');await field(page,'',['trigger','to']).selectOption('done');
      const node=(await state(page)).draft.definition.steps[0].nodeId;
      await page.locator(`[data-auto-node="${node}"][data-auto-kind="node-type"]`).selectOption('notify');await field(page,node,['payload','message']).fill('Browser persisted effect');
      const created=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations`,()=>action(page,'save').click());await idle(page);
      const id=created.rule.ruleId;assert.deepEqual((await state(page)).draft.definition,created.version.definition);
      await sample(page);const before=await content(c);const projection=await preview(page,c,id);assert.deepEqual(await content(c),before);assert.equal(projection.effects[0].type,'notify');
      await shot(page,'created-preview');await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${id}/activate`,()=>action(page,'activate').click());await idle(page);
      const event=await c.edit('subject',{status:'done'});const processor=suite.processor('phase7-browser');await processor.processEvent(event);
      const runs=(await c.rows('runs')).filter(r=>r.ruleId===id);assert.equal(runs.length,1);await processor.processRun(runs[0].runId);
      assert.equal((await c.rows('runs')).find(r=>r.runId===runs[0].runId).state,'completed');
      const notes=(await c.rows('notifications')).filter(n=>n.category==='automation'&&n.message==='Browser persisted effect');assert.equal(notes.length,1);assert.equal(notes[0].recipientUid,c.uids.editor);
      await action(page,'runs').click();await action(page,'history-run').first().click();await page.waitForFunction(()=>!!window.projectsAutomationsController.getState().history.run);assert.match(await page.locator('.crm-auto-history').innerText(),/completed/);
      await action(page,'close-history').click();await action(page,'versions').click();await action(page,'history-version').first().click();await page.locator('[data-auto-history-definition]').waitFor();await shot(page,'immutable-run-history');
      await action(page,'close-history').click();await field(page,node,['payload','message']).fill('Browser revised effect');assert.equal((await state(page)).preview,null);assert.equal(await action(page,'activate').isDisabled(),true);
      const changed=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${id}/versions`,()=>action(page,'save').click());await idle(page);assert.notEqual(changed.version.versionId,created.version.versionId);await sample(page);await preview(page,c,id);
      const copy=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${id}/duplicate`,()=>action(page,'duplicate').click());await idle(page);assert.equal(copy.rule.enabled,false);assert.equal(copy.rule.candidateVersion,null);
      await responseAction(page,'PATCH',`/api/projects/${c.projectId}/automations/${id}`,()=>action(page,'disable').click());await idle(page);assert.equal(h.expectStatus(await c.get(`/automations/${id}`),200).rule.enabled,false);
      await page.locator('#auto-actor').selectOption(c.uids.editor);const transferred=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${id}/versions`,()=>action(page,'save').click());await idle(page);assert.equal(transferred.version.actorUid,c.uids.editor);
    });
    await run('nested recipe and connected blocks preserve one persisted definition',async()=>{
      await open(page,url,c);await openRule(page,c,complex.rule.ruleId);const original=(await state(page)).draft.definition;
      await action(page,'blocks').click();assert.deepEqual((await state(page)).draft.definition,original);await field(page,'nested',['payload','message']).fill('Edited in connected blocks');const expected=(await state(page)).draft.definition;
      await action(page,'recipe').click();assert.deepEqual((await state(page)).draft.definition,expected);assert.equal(await field(page,'nested',['payload','message']).inputValue(),'Edited in connected blocks');
      const saved=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${complex.rule.ruleId}/versions`,()=>action(page,'save').click());await idle(page);assert.deepEqual(saved.version.definition,expected);
      const persisted=h.expectStatus(await c.get(`/automations/${complex.rule.ruleId}?versionId=${saved.version.versionId}`),200);assert.deepEqual(persisted.version.definition,expected);await shot(page,'recipe-blocks-equality');
    });
    await run('native typing preserves caret and keyboard actions retain focus through designer rerenders',async()=>{
      await open(page,url,c);await openRule(page,c,complex.rule.ruleId);
      const title=page.locator('#auto-title');await title.fill('Keyboard title');await title.press('Home');
      for(let index=0;index<9;index++)await page.keyboard.press('ArrowRight');
      for(const character of 'native ')await page.keyboard.type(character);
      const titleEvidence=await title.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,focused:document.activeElement===el}));
      assert.deepEqual(titleEvidence,{value:'Keyboard native title',start:16,end:16,focused:true});
      const message=field(page,'nested',['payload','message']);await message.fill('Alpha omega');await message.press('Home');
      for(let index=0;index<6;index++)await page.keyboard.press('ArrowRight');
      for(const character of 'beta ')await page.keyboard.type(character);
      const messageEvidence=await message.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,focused:document.activeElement===el}));
      assert.deepEqual(messageEvidence,{value:'Alpha beta omega',start:11,end:11,focused:true});
      assert.equal((await state(page)).draft.definition.steps[0].then[0].payload.message,'Alpha beta omega');
      await action(page,'blocks').focus();await page.keyboard.press('Enter');
      assert.equal((await state(page)).representation,'blocks');assert.equal(await action(page,'blocks').evaluate(el=>document.activeElement===el),true);
      await page.keyboard.press('Shift+Tab');assert.equal(await action(page,'recipe').evaluate(el=>document.activeElement===el),true);
      await page.keyboard.press('Enter');assert.equal((await state(page)).representation,'recipe');assert.equal(await action(page,'recipe').evaluate(el=>document.activeElement===el),true);
      const add=page.locator('[data-auto-action="add-step"][data-parent-id=""][data-branch="steps"]');
      const count=(await state(page)).draft.definition.steps.length;await add.focus();await page.keyboard.press('Space');
      assert.equal((await state(page)).draft.definition.steps.length,count+1);assert.equal(await add.evaluate(el=>document.activeElement===el),true);
      report.keyboard={title:titleEvidence,message:messageEvidence,representation:'recipe',topLevelSteps:count+1};await shot(page,'keyboard-caret-and-actions');
    });
    await run('narrow designer layout contains native controls and representation buttons remain clickable',async()=>{
      await open(page,url,c);await openRule(page,c,complex.rule.ruleId);const originalViewport=page.viewportSize();
      try {
        await page.setViewportSize({width:390,height:844});await page.locator('#auto-title').scrollIntoViewIfNeeded();
        const layout=await page.locator('#projects-automations').evaluate(root=>{
          const rect=root.getBoundingClientRect();
          const controls=Array.from(root.querySelectorAll('input,select,textarea,button')).filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,label:el.id||el.dataset.autoAction||el.dataset.autoKind||el.name,left:r.left,right:r.right,width:r.width};});
          return {viewport:innerWidth,left:rect.left,right:rect.right,clientWidth:root.clientWidth,scrollWidth:root.scrollWidth,controls};
        });
        report.narrowLayout=layout;assert.ok(layout.clientWidth>0);assert.ok(layout.left>=-1&&layout.right<=layout.viewport+1,JSON.stringify(layout));
        assert.ok(layout.scrollWidth<=layout.clientWidth+1,'designer itself must not require horizontal scrolling');
        assert.ok(layout.controls.length>10,'inspect the actual nested designer controls');
        assert.deepEqual(layout.controls.filter(control=>control.width<=0||control.left<layout.left-1||control.right>layout.right+1),[],'native controls must fit inside the designer');
        await action(page,'blocks').scrollIntoViewIfNeeded();
        const hit=await action(page,'blocks').evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,receivesPointer:el.contains(document.elementFromPoint(x,y))};});
        report.narrowHit=hit;assert.equal(hit.visible,true);assert.equal(hit.receivesPointer,true);await action(page,'blocks').click();assert.equal((await state(page)).representation,'blocks');await shot(page,'narrow-designer-390px');
      } finally {await page.setViewportSize(originalViewport);}
    });
    await run('missing target is retained for explicit repair without clearing project authority',async()=>{
      await c.lifecycle('repair-target','archive');await open(page,url,c);await openRule(page,c,repair.rule.ruleId);
      assert.equal((await state(page)).draft.definition.steps[0].payload.target.taskId,'repair-target');assert.equal((await state(page)).owner,true);
      assert.match(await page.locator('#projects-automations').innerText(),/unavailable|repair|reference/i);
      await field(page,'repair',['payload','target']).selectOption('trigger_task');const saved=await responseAction(page,'POST',`/api/projects/${c.projectId}/automations/${repair.rule.ruleId}/versions`,()=>action(page,'save').click());await idle(page);assert.equal(saved.version.definition.steps[0].payload.target,'trigger_task');await sample(page);await preview(page,c,repair.rule.ruleId);await shot(page,'missing-reference-repaired');
    });
    await run('held preview cannot overwrite newer unsaved text',async()=>{
      await open(page,url,c);await openRule(page,c,scoped.rule.ruleId);await sample(page);
      await held(page,`**/api/projects/${c.projectId}/automations/${scoped.rule.ruleId}/preview`,()=>action(page,'preview').click(),()=>field(page,'scope',['payload','message']).fill('Newer held-response draft'),async()=>{const s=await state(page);assert.equal(s.draft.definition.steps[0].payload.message,'Newer held-response draft');assert.equal(s.preview,null);assert.equal(s.dirty,true);});
    });
    await run('held rule response cannot repopulate another project',async()=>{
      await open(page,url,c);await openRule(page,c,scoped.rule.ruleId);
      await held(page,`**/api/projects/${c.projectId}/automations/${scoped.rule.ruleId}`,()=>action(page,'refresh-rule').click(),()=>chooseProject(page,second.projectId),async()=>{const s=await state(page);assert.equal(s.projectId,second.projectId);assert.equal(s.draft,null);assert.equal(s.rule,null);h.noSecrets(s,['Private scope sentinel']);});
    });
    await run('Owner downgrade clears designer while task API remains authorized',async()=>{
      await open(page,url,c);await openRule(page,c,scoped.rule.ruleId);const ref=c.memberRef('owner'),saved=(await ref.get()).data();
      try {await ref.update({role:'Editor'});await responseAction(page,'GET',`/api/projects/${c.projectId}/automations/${scoped.rule.ruleId}`,()=>action(page,'refresh-rule').click(),403);await page.waitForFunction(()=>!window.projectsAutomationsController.getState().owner);const s=await state(page);assert.equal(s.draft,null);assert.equal(s.preview,null);assert.equal(await page.locator('#projects-automations').isHidden(),true);h.expectStatus(await c.get('/tasks/subject'),200);await shot(page,'owner-downgrade');}finally{await ref.set(saved);}
    });
    await run('held preview cannot restore prior account private content',async()=>{
      await open(page,url,c);await openRule(page,c,scoped.rule.ruleId);await sample(page);
      await held(page,`**/api/projects/${c.projectId}/automations/${scoped.rule.ruleId}/preview`,()=>action(page,'preview').click(),async()=>{
        await page.evaluate(async({email,password})=>{await firebase.auth().signInWithEmailAndPassword(email,password);},{email:h.USERS.viewer,password:h.PASSWORD}).catch(error=>{if(!/context.*destroyed|navigation/i.test(error.message))throw error;});
        await page.waitForFunction(uid=>window.projectsAutomationsController?.getState().actorUid===uid,c.uids.viewer);
      },async()=>{const s=await state(page);assert.equal(s.actorUid,c.uids.viewer);assert.equal(s.draft,null);assert.equal(s.preview,null);h.noSecrets(s,['Private scope sentinel']);assert.equal(await page.locator('#projects-automations').isHidden(),true);});
    });
    await run('no unhandled page exceptions or Projects server failures',async()=>{assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.network.filter(r=>r.status>=500),[]);});
  } finally {
    for(const release of releases)release();
    const cleanup=async(label,fn)=>{let timer;try{await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} cleanup timed out`)),5000);})]);}catch(error){report.cases.push({name:`${label} cleanup`,passed:false,error:error.stack});}finally{clearTimeout(timer);}};
    if(browser)await cleanup('Chrome',()=>browser.close());suite.server.closeAllConnections?.();await cleanup('fixture',()=>suite.close());
    report.finishedAt=new Date().toISOString();report.passed=report.cases.filter(r=>r.passed).length;fs.writeFileSync(path.join(ARTIFACTS,'report.json'),JSON.stringify(report,null,2));
  }
  process.stdout.write(JSON.stringify({passed:report.passed,cases:report.cases.length,report:path.join(ARTIFACTS,'report.json')})+'\n');if(report.cases.some(r=>!r.passed))process.exitCode=1;
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
