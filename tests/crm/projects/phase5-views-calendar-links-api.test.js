'use strict';
const assert = require('assert');
const { bootPhase5, task, createProject, clearProject, expectStatus, jsonRequest, request, noSecrets, caseRun, finish } = require('./phase5-test-helpers');
async function main() {
    const c = await bootPhase5('phase5-api'); const results=[];
    const run=(name,fn)=>caseRun(name,fn,results);
    try {
        await task(c,'a',{ownerUid:c.uids.owner,assigneeUids:[c.uids.editor]}); await task(c,'b'); await task(c,'linked');
        const owner = await c.token('owner'); const admin = await c.token('admin@demo.crm-projects.test');
        const deps=async(id,values,op)=>({operationId:op,expectedRevision:(await c.data(id)).revision,expectedStructureRevision:(await c.revision()).structureRevision,predecessorTaskIds:values});
        const preview=async(id='a')=>expectStatus(await c.send('/schedule-preview',{taskId:id,expectedRevision:(await c.data(id)).revision,startDate:'2026-03-02',dueDate:'2026-03-06'},'owner','POST'),200).preview;
        const apply=(p,op,role='owner')=>c.send('/schedule-apply',{operationId:op,previewToken:p.token},role,'POST');
        await run('calendar inclusive leave, legacy, independent admin and member privacy',async()=>{
            await c.configure([{startDate:'2026-03-03',endDate:'2026-03-04',scope:'whole_team',label:'PRIVATE_WHOLE'}, {date:'2026-03-05',scope:'specific_person',uid:c.uids.editor,label:'PRIVATE_PERSON'}, {date:'2026-03-06',scope:'specific_person',uid:'crm-projects-admin',label:'PRIVATE_UNRELATED'}]);
            const body=expectStatus(await c.get('/calendar?fromDate=2026-03-02&toDate=2026-03-06','viewer'),200);
            noSecrets(body,['PRIVATE_WHOLE','PRIVATE_PERSON','PRIVATE_UNRELATED','crm-projects-admin']);
            assert.deepStrictEqual(body.calendar.days.map(d=>d.organization.working),[true,false,false,true,true]);
            assert.strictEqual(body.calendar.days[3].members.find(m=>m.uid===c.uids.editor).working,false);
            assert.strictEqual((await request(c.server,'/api/projects/calendar',owner)).status,403);
            assert.strictEqual((await jsonRequest(c.server,'/api/projects/calendar',admin,'PATCH',{expectedRevision:0,leaves:[]})).status,409);
            assert.strictEqual((await c.get('/calendar?fromDate=2026-02-30&toDate=2026-03-06')).status,400);
            const before=await c.data('a'); const p=await preview(); assert.deepStrictEqual(await c.data('a'),before); assert.strictEqual(p.workingDayCount,3); assert.ok(p.warnings.some(w=>w.code==='ASSIGNEE_LEAVE'));
        });
        await run('calendar cleared choice persists and blocks schedule',async()=>{
            const before=(await c.calendarRef.get()).data();
            expectStatus(await jsonRequest(c.server,'/api/projects/calendar',admin,'PATCH',{expectedRevision:before.revision,holidayChoices:{2026:{nationalDayAdjacent:'before'}}}),200);
            const stored=(await c.calendarRef.get()).data(); assert.strictEqual(stored.holidayChoices[2026].tetScheme,undefined); assert.deepStrictEqual(stored.leaves,before.leaves);
            const p=await preview(); assert.strictEqual(p.canApply,false); assert.ok(p.warnings.some(w=>w.code==='CALENDAR_INCOMPLETE'));
        });
        await c.configure();
        await run('dependency validation, concurrent cycle, exact replay, Undo',async()=>{
            for(const [values,status] of [[['a'],400],[['b','b'],400],[['foreign-task'],400]]) expectStatus(await c.send('/tasks/a/dependencies',await deps('a',values,`bad-${values.join('-')}`)),status);
            const pa=await deps('a',['b'],'race-a'); const pb=await deps('b',['a'],'race-b');
            const responses=await Promise.all([c.send('/tasks/a/dependencies',pa),c.send('/tasks/b/dependencies',pb)]); assert.strictEqual(responses.filter(r=>r.status===200).length,1);
            const win=responses[0].status===200?'a':'b'; const payload=win==='a'?pa:pb;
            expectStatus(await c.send(`/tasks/${win}/dependencies`,payload),200); assert.strictEqual((await c.data(win)).revision,payload.expectedRevision+1);
            expectStatus(await c.send(`/tasks/${win}/dependencies`,{...payload,predecessorTaskIds:[]}),409);
            expectStatus(await c.send(`/operations/${payload.operationId}/undo`,{operationId:'undo-deps'},'owner','POST'),200);
            assert.deepStrictEqual((await c.data(win)).predecessorTaskIds,[]);
        });
        await run('archived predecessor tombstone, no resurrection or implicit date edits',async()=>{
            expectStatus(await c.send('/tasks/a/dependencies',await deps('a',['b'],'archive-edge')),200);
            const before=await c.data('a');
            expectStatus(await c.send('/tasks/b/archive',{operationId:'archive-b',expectedRevision:(await c.data('b')).revision,expectedStructureRevision:(await c.revision()).structureRevision},'owner','POST'),200);
            const page=expectStatus(await c.get('/views'),200); assert.ok(page.tasks.find(t=>t.id==='a').dependencyWarnings.some(w=>w.code==='DEPENDENCY_UNAVAILABLE'));
            assert.deepStrictEqual(await c.data('a'),before); assert.strictEqual((await c.data('b')).lifecycle,'archived');
            expectStatus(await c.send('/tasks/b/restore',{operationId:'restore-b',expectedRevision:(await c.data('b')).revision,expectedStructureRevision:(await c.revision()).structureRevision},'owner','POST'),200);
        });
        await run('preview rejects task calendar dependency actor expired and forged tokens; exact apply/Undo',async()=>{
            for(const mutation of [async()=>c.taskRef('a').update({revision:(await c.data('a')).revision+1}),async()=>c.calendarRef.update({revision:(await c.calendarRef.get()).data().revision+1}),async()=>c.taskRef('b').update({dueDate:'2026-03-09'}),async()=>expectStatus(await c.send('/tasks/a/dependencies',await deps('a',[],'preview-change-edges')),200)]) { const p=await preview(); await mutation(); expectStatus(await apply(p,`stale-${results.length}-${p.token.slice(-6)}`),409); }
            let p=await preview(); expectStatus(await apply(p,'wrong-actor','editor'),409);
            const otherId='phase5-api-other'; await clearProject(c.db,otherId); await createProject({...c,projectId:otherId});
            expectStatus(await jsonRequest(c.server,`/api/projects/${otherId}/schedule-apply`,await c.token('owner'),'POST',{operationId:'wrong-project',previewToken:p.token}),409);
            expectStatus(await apply({token:'forged'},'forged'),400);
            await c.projectRef.collection('schedulePreviews').doc(p.token.split('.')[0]).update({expiresAt:'2000-01-01T00:00:00Z'}); expectStatus(await apply(p,'expired'),409);
            p=await preview(); const revision=(await c.data('a')).revision; expectStatus(await apply(p,'apply-exact'),200); expectStatus(await apply(p,'apply-exact'),200);
            assert.strictEqual((await c.data('a')).revision,revision+1); assert.strictEqual((await c.data('a')).startDate,'2026-03-02');
            expectStatus(await c.send('/operations/apply-exact/undo',{operationId:'undo-apply'},'owner','POST'),200); assert.strictEqual((await c.data('a')).startDate,p.before.startDate);
        });
        const secrets=['secret-lead-id','Canonical secret lead','secret-student-id','Canonical secret student','secret-class-id','Canonical secret class'];
        const links=[{type:'lead',recordId:secrets[0]},{type:'student',recordId:secrets[2]},{type:'classroom',recordId:secrets[4]}];
        for(const [index,collection] of ['crmLeads','crmStudents','crmClassrooms'].entries()) await c.db.collection(collection).doc(secrets[index*2]).set({name:secrets[index*2+1],privateField:'never return'});
        for(const level of ['project','task']) await run(`${level} references auth, name-only lookup, save/read/remove/replay/revoke and generic leak fences`,async()=>{
            const suffix=level==='project'?'/links':'/tasks/linked/links'; const rev=async()=>level==='project'?(await c.revision()).revision:(await c.data('linked')).revision;
            const body={operationId:`link-${level}`,expectedRevision:await rev(),links};
            expectStatus(await c.send(suffix,body),403);
            await c.db.collection('users').doc(c.uids.owner).update({isAdmin:true});
            for(const type of ['lead','student','classroom']) {const options=expectStatus(await c.get(`/crm-link-options?type=${type}&query=Canonical`),200).options; assert.ok(options.some(o=>o.type===type&&o.label===secrets[['lead','student','classroom'].indexOf(type)*2+1])); for(const o of options) assert.deepStrictEqual(Object.keys(o).sort(),['label','recordId','type']);}
            expectStatus(await c.send(suffix,{...body,links:[{...links[0],label:'FORGED'}]}),400);
            expectStatus(await c.send(suffix,{...body,links:[{type:'lead',recordId:'absent'}]}),400);
            noSecrets(expectStatus(await c.send(suffix,body),200),secrets); noSecrets(expectStatus(await c.send(suffix,body),200),secrets);
            assert.strictEqual(expectStatus(await c.get(suffix),200).links.length,3);
            await c.restartApi();
            assert.deepStrictEqual(expectStatus(await c.get(suffix),200).links.map(({type,recordId})=>({type,recordId})),links);
            assert.deepStrictEqual(expectStatus(await c.get(suffix,'owner','/legacy/projects'),200).links,[]);
            const oldEmail=process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL='teacher@demo.crm-projects.test';
            try { assert.strictEqual(expectStatus(await c.get(suffix,'owner','/local/projects'),200).links.length,3); process.env.ADMIN_EMAIL='other@example.invalid'; assert.strictEqual(expectStatus(await c.get(suffix,'owner','/local/projects'),200).links.length,0); } finally {if(oldEmail===undefined)delete process.env.ADMIN_EMAIL;else process.env.ADMIN_EMAIL=oldEmail;}
            expectStatus(await c.get(suffix,'admin@demo.crm-projects.test'),404);
            await c.auth.setCustomUserClaims(c.uids.owner,{admin:true,isAdmin:true}); const staleToken=await c.token('owner'); await c.db.collection('users').doc(c.uids.owner).update({isAdmin:false});
            await c.restartApi();
            noSecrets(expectStatus(await request(c.server,`/api/projects/${c.projectId}${suffix}`,staleToken),200),secrets);
            expectStatus(await jsonRequest(c.server,`/api/projects/${c.projectId}${suffix}`,staleToken,'PATCH',body),403);
            for(const endpoint of ['/views','/tasks','/history','/recovery']) noSecrets(expectStatus(await c.get(endpoint),200),secrets);
            noSecrets(expectStatus(await c.send('/tasks/linked',{operationId:`generic-task-${level}`,expectedRevision:(await c.data('linked')).revision,title:`Public ${level}`}),200),secrets);
            await c.projectRef.update({crmLinks:links});
            const genericProject={operationId:`generic-project-${level}`,expectedRevision:(await c.revision()).revision,name:`Public ${level}`};
            noSecrets(expectStatus(await c.send('',genericProject),200),secrets); noSecrets(expectStatus(await c.send('',genericProject),200),secrets);
            await c.db.collection('users').doc(c.uids.owner).update({isAdmin:true});
            await c.db.collection('crmLeads').doc(secrets[0]).update({deleted:true}); assert.strictEqual(expectStatus(await c.get(suffix),200).links.length,2);
            await c.db.collection('crmLeads').doc(secrets[0]).update({deleted:false});
            expectStatus(await c.send(suffix,{operationId:`remove-${level}`,expectedRevision:await rev(),links:[]}),200); assert.deepStrictEqual(expectStatus(await c.get(suffix),200).links,[]);
            await c.db.collection('users').doc(c.uids.owner).update({isAdmin:false});
        });
        await run('CRM-authorized Viewer has no editing affordance in task links or shared views',async()=>{
            await c.db.collection('users').doc(c.uids.viewer).update({isAdmin:true});
            await c.db.collection('users').doc(c.uids.owner).update({isAdmin:true});
            expectStatus(await c.send('/tasks/linked/links',{operationId:'viewer-fixture',expectedRevision:(await c.data('linked')).revision,links}),200);
            const readonly=expectStatus(await c.get('/tasks/linked/links','viewer'),200); assert.strictEqual(readonly.links.length,3); assert.strictEqual(readonly.canManage,false);
            expectStatus(await c.send('/tasks/linked/links',{operationId:'viewer-write',expectedRevision:(await c.data('linked')).revision,links:[]},'viewer'),403);
            assert.strictEqual(expectStatus(await c.get('/views','viewer'),200).linkAccess.canManage,false);
        });
    } finally { await c.close(); }
    finish(results);
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
