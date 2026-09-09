'use strict';
const assert = require('node:assert/strict');
const { bootSuite, project, definition, notify, expectStatus, assertDenied, caseRun, finish, COLLECTIONS } = require('./phase6-test-helpers');

async function content(c) {
    const result={};
    for(const name of ['tasks','sections','columns'])result[name]=(await c.projectRef.collection(name).get()).docs.map(d=>({id:d.id,...d.data()}));
    for(const name of ['crmProjectOperations','crmProjectEvents','runs','journals','notifications'])result[name]=await c.rows(name);
    return result;
}
async function pages(c,filters={},role='owner') {
    const rows=[];const seen=new Set();let cursor=null,first;
    for(let page=0;page<30;page++) {
        const q=new URLSearchParams({...filters,pageSize:'7'});if(cursor)q.set('cursor',cursor);
        const body=expectStatus(await c.get(`/automations?${q}`,role),200);first ||= body;rows.push(...body.items);
        if(!body.hasMore){assert.equal(body.nextCursor,null);assert.equal(new Set(rows.map(r=>r.ruleId)).size,rows.length);return {rows,first};}
        assert.ok(body.nextCursor&&!seen.has(body.nextCursor),'continuation must advance even on an empty filtered page');seen.add(body.nextCursor);cursor=body.nextCursor;
    }
    assert.fail('filtered management pagination did not converge');
}
async function main() {
    const s=await bootSuite();const results=[];const run=(name,fn)=>caseRun(name,fn,results);
    try {
        await run('server filters traverse more than 200 nonmatches with exact complete IDs and fenced cursors',async()=>{
            const c=await project(s,'p7-list');await c.task('subject',{ownerUid:c.uids.editor});expectStatus(await c.send(`/members/${c.uids.editor}`,{role:'Owner'},'owner','PATCH'),200);
            const seed=await c.createRule(definition([notify('n')]));const oracle=[seed.rule];const writes=[];
            // Scale fixture provenance: clone one valid API-created disabled rule
            // and immutable definition, giving every clone its own rule/version
            // IDs. Only management reads use these batch-seeded records; effect
            // execution below is independently created/activated through APIs.
            for(let i=0;i<240;i++) {
                const ruleId=`a-phase7-${String(i).padStart(3,'0')}`;const versionId=`v-${ruleId}`;const candidateVersion=i>=210&&i%2===0?`candidate-${ruleId}`:null;
                const rule={...seed.rule,ruleId,title:i<210?`Noise ${i}`:`Needle ${i}`,folder:i%3===0?'':i%3===1?'Alpha':'Beta',enabled:i>=210&&i%2===0,currentVersion:versionId,candidateVersion};
                const version={...seed.version,ruleId,versionId};oracle.push(rule);writes.push([COLLECTIONS.rules,ruleId,rule],[COLLECTIONS.versions,versionId,version]);if(candidateVersion)writes.push([COLLECTIONS.versions,candidateVersion,{...version,versionId:candidateVersion,actorUid:c.uids.editor}]);
            }
            for(let start=0;start<writes.length;start+=400){const batch=s.db.batch();for(const [collection,id,value] of writes.slice(start,start+400))batch.set(s.db.collection(collection).doc(id),value);await batch.commit();}
            const filters={query:' nEeDlE ',folder:'',enabled:'false'};const filtered=await pages(c,filters);assert.equal(filtered.first.items.length,0);assert.equal(filtered.first.hasMore,true);
            const expected=oracle.filter(r=>r.title.toLowerCase().includes('needle')&&!r.folder&&!r.enabled).map(r=>r.ruleId).sort();assert.deepEqual(filtered.rows.map(r=>r.ruleId).sort(),expected);
            for(const options of [{query:'Needle'},{folder:'Alpha'},{folder:''},{enabled:'true'},{query:'Needle',folder:'Beta',enabled:'false'}]) {
                const actual=await pages(c,options);const ids=oracle.filter(r=>(!options.query||r.title.includes(options.query))&&(options.folder===undefined||r.folder===options.folder)&&(options.enabled===undefined||r.enabled===(options.enabled==='true'))).map(r=>r.ruleId).sort();assert.deepEqual(actual.rows.map(r=>r.ruleId).sort(),ids);
                for(const row of actual.rows){assert.equal(row.validationState,'not_checked');assert.equal(row.activeActorUid,row.enabled?c.uids.owner:null);assert.equal(row.draftActorUid,row.candidateVersion?c.uids.editor:c.uids.owner);}
            }
            const cursor=filtered.first.nextCursor;for(const changed of [{...filters,query:'other'},{...filters,folder:'Beta'},{...filters,enabled:'true'}])assertDenied(await c.get(`/automations?${new URLSearchParams({...changed,pageSize:'7',cursor})}`),400);
            assertDenied(await c.get(`/automations?${new URLSearchParams({...filters,pageSize:'7',cursor})}`,'editor'),400);
            const other=await project(s,'p7-other');assertDenied(await other.get(`/automations?${new URLSearchParams({...filters,pageSize:'7',cursor})}`),400);
            for(const query of ['enabled=maybe','query='+encodeURIComponent('x'.repeat(201)),'folder='+encodeURIComponent('bad\nfolder'),'unknown=true'])assertDenied(await c.get(`/automations?${query}`),400);
        });
        await run('ordered preview shows exact sequential values, immutable pre-delay branch and provisional future output without effects',async()=>{
            const c=await project(s,'p7-preview');await c.task('parent');await c.task('subject',{parentTaskId:'parent',title:'Original',ownerUid:c.uids.editor});
            const steps=[{nodeId:'first',type:'set_field',payload:{patch:{title:'Intermediate'}}},{nodeId:'second',type:'set_field',payload:{patch:{title:'Final'}}},{nodeId:'choice',type:'if',condition:{field:'title',operator:'equals',value:'Original'},then:[notify('original','Original branch')],else:[notify('wrong','Wrong branch')]},{nodeId:'move',type:'move_section',payload:{sectionId:'s2'}},{nodeId:'child',type:'create_task',payload:{sectionId:'s1',parent:'trigger_task',task:{title:'Child'}}},{nodeId:'wait',type:'delay',payload:{durationMs:1000}},{nodeId:'future',type:'if',condition:{field:'title',operator:'equals',value:'Final'},then:[notify('provisional','Possible future')],else:[notify('otherfuture','Other future')]}];
            const created=await c.createRule(definition(steps));const before=await content(c);const preview=expectStatus(await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId:created.version.versionId,sampleTaskId:'subject'}),200);assert.deepEqual(await content(c),before);
            assert.equal(preview.conditionMatched,true);assert.deepEqual(preview.effects.map(e=>e.path),['/first','/second','/choice/then/original','/move','/child','/wait','/future/then/provisional']);assert.deepEqual(preview.effects.map(e=>e.sequence),[1,2,3,4,5,6,7]);
            assert.deepEqual(preview.effects[0].changes,[{field:'title',before:'Original',after:'Intermediate'}]);assert.deepEqual(preview.effects[1].changes,[{field:'title',before:'Intermediate',after:'Final'}]);assert.deepEqual(preview.effects[2].recipientUids,[c.uids.editor]);assert.equal(preview.effects[2].provisional,false);
            assert.ok(preview.effects[3].changes.some(x=>x.field==='parentTaskId'&&x.before==='parent'&&x.after===null));assert.deepEqual(preview.effects[3].section,{sectionId:'s2',label:'Other section'});assert.deepEqual(preview.effects[4].parent,{taskId:'subject',label:'Final'});assert.equal(preview.effects[4].target.taskId,null);assert.equal(preview.effects[4].section.sectionId,'s2');assert.equal(preview.effects[6].provisional,true);assert.ok(preview.warnings.some(w=>/provisional/i.test(w)));assert.ok(preview.warnings.some(w=>/parent/i.test(w)));
            const unmatched=await c.createRule(definition([notify('none')],undefined,{field:'status',operator:'equals',value:'blocked'}));const noMatch=expectStatus(await c.send(`/automations/${unmatched.rule.ruleId}/preview`,{versionId:unmatched.version.versionId,sampleTaskId:'subject'}),200);assert.equal(noMatch.conditionMatched,false);assert.deepEqual(noMatch.effects,[]);
        });
        for(const initial of ['empty','changed'])await run(`${initial} accountable owner assignment projects the actual activated notification recipient`,async()=>{
            const c=await project(s,`p7-owner-${initial}`);await c.task('subject',{ownerUid:initial==='empty'?null:c.uids.editor});const desired=initial==='empty'?c.uids.editor:c.uids.viewer;
            const created=await c.createRule(definition([{nodeId:'assign',type:'assign',payload:{ownerUid:desired,assigneeUids:[]}},notify('notify','Projected recipient')]));const before=await content(c);const preview=expectStatus(await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId:created.version.versionId,sampleTaskId:'subject'}),200);assert.deepEqual(await content(c),before);assert.deepEqual(preview.effects[1].recipientUids,[desired]);
            expectStatus(await c.send(`/automations/${created.rule.ruleId}/activate`,{operationId:c.op('activate'),expectedRevision:created.rule.revision,versionId:created.version.versionId,previewToken:preview.previewToken}),200);
            const event=await c.edit('subject',{status:'done'});const p=s.processor();await p.processEvent(event);const runs=await c.rows('runs');assert.equal(runs.length,1);await p.processRun(runs[0].runId);assert.equal((await c.rows('runs'))[0].state,'completed');assert.equal((await c.taskData('subject')).ownerUid,desired);const notes=(await c.rows('notifications')).filter(n=>n.category==='automation');assert.equal(notes.length,1);assert.equal(notes[0].recipientUid,preview.effects[1].recipientUids[0]);
        });
        await run('create preview matches canonical defaults for designated actor and preserves explicit null owner',async()=>{
            const c=await project(s,'p7-create-defaults');await c.task('subject',{ownerUid:c.uids.viewer});expectStatus(await c.send(`/members/${c.uids.editor}`,{role:'Owner'},'owner','PATCH'),200);
            const steps=[{nodeId:'default',type:'create_task',payload:{sectionId:'s1',task:{title:'Default owner'}}},{nodeId:'unassigned',type:'create_task',payload:{sectionId:'s1',task:{title:'Explicit unassigned',ownerUid:null}}}];
            const draft=await c.createRule(definition(steps));const version=expectStatus(await c.send(`/automations/${draft.rule.ruleId}/versions`,{operationId:c.op('actor'),expectedRevision:draft.rule.revision,definition:definition(steps),actorUid:c.uids.editor}),200);
            const before=await content(c);const preview=expectStatus(await c.send(`/automations/${draft.rule.ruleId}/preview`,{versionId:version.version.versionId,sampleTaskId:'subject'}),200);assert.deepEqual(await content(c),before);
            for(let i=0;i<2;i++){const fields=Object.fromEntries(preview.effects[i].changes.map(change=>[change.field,change.after]));assert.equal(fields.ownerUid,i===0?c.uids.editor:null);assert.equal(fields.status,'not_started');assert.deepEqual(fields.assigneeUids,[]);assert.equal(fields.startDate,null);assert.equal(fields.dueDate,null);assert.equal(preview.effects[i].changes.filter(change=>change.field.startsWith('values.')).length,0);}
            await c.activate(version);const event=await c.edit('subject',{status:'done'});const p=s.processor();await p.processEvent(event);const runs=await c.rows('runs');assert.equal(runs.length,1);await p.processRun(runs[0].runId);assert.equal((await c.rows('runs'))[0].state,'completed');
            const tasks=(await c.projectRef.collection('tasks').get()).docs.map(d=>d.data());for(let i=0;i<2;i++){const stored=tasks.find(t=>t.title===steps[i].payload.task.title);assert.ok(stored);for(const change of preview.effects[i].changes)if(!change.field.startsWith('values.'))assert.deepEqual(stored[change.field],change.after);assert.deepEqual(stored.values,{});assert.equal(stored.ownerUid,i===0?c.uids.editor:null);}
            const invalid=await c.createRule(definition([{nodeId:'overlap',type:'create_task',payload:{sectionId:'s1',task:{title:'Invalid defaults',assigneeUids:[c.uids.owner]}}}]));const conflict=await c.send(`/automations/${invalid.rule.ruleId}/preview`,{versionId:invalid.version.versionId,sampleTaskId:'subject'});assertDenied(conflict,400);assert.equal(conflict.body.error,'INVALID_ASSIGNEES');
        });
        await run('composite owner/additional-assignee conflict fails dry preview without mutation',async()=>{
            const c=await project(s,'p7-owner-conflict');await c.task('subject',{ownerUid:c.uids.owner,assigneeUids:[c.uids.editor]});const created=await c.createRule(definition([{nodeId:'owner',type:'set_field',payload:{patch:{ownerUid:c.uids.editor}}},notify('n')]));const before=await content(c);
            const response=await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId:created.version.versionId,sampleTaskId:'subject'});assertDenied(response,400);assert.equal(response.body.error,'INVALID_ASSIGNEES');assert.deepEqual(await content(c),before);
        });
        await run('Owner-only 403 preserves task access and resource 404 codes remain distinct',async()=>{
            const c=await project(s,'p7-authority');await c.task('subject',{ownerUid:c.uids.editor});const created=await c.createRule(definition([notify('n')]));
            for(const [url,code] of [['/automations/absent','AUTOMATION_NOT_FOUND'],[`/automations/${created.rule.ruleId}?versionId=absent`,'AUTOMATION_VERSION_NOT_FOUND'],['/automation-runs/absent','RUN_NOT_FOUND']]){const response=await c.get(url);assertDenied(response,404);assert.equal(response.body.error,code);expectStatus(await c.get('/tasks/subject'),200);}
            const missing=await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId:created.version.versionId,sampleTaskId:'absent'});assertDenied(missing,404);expectStatus(await c.get('/tasks/subject'),200);
            const member=(await c.memberRef('owner').get()).data();try{await c.memberRef('owner').update({role:'Editor'});assertDenied(await c.get('/automations'),403);assertDenied(await c.get(`/automations/${created.rule.ruleId}`),403);expectStatus(await c.get('/tasks/subject'),200);}finally{await c.memberRef('owner').set(member);}
        });
        await run('static broken references stay diagnosable and activation rechecks changed references',async()=>{
            const c=await project(s,'p7-references');await c.task('subject',{ownerUid:c.uids.editor});await c.task('explicit');const created=await c.createRule(definition([{nodeId:'target',type:'set_field',payload:{target:{taskId:'explicit'},patch:{title:'Changed'}}},notify('n')]));const preview=expectStatus(await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId:created.version.versionId,sampleTaskId:'subject'}),200);
            await c.lifecycle('explicit','archive');const before=await content(c);const opened=expectStatus(await c.get(`/automations/${created.rule.ruleId}`),200);assert.ok(opened.diagnostics.length);assert.equal(opened.version.definition.steps[0].payload.target.taskId,'explicit');
            const activation=await c.send(`/automations/${created.rule.ruleId}/activate`,{operationId:c.op('stale-ref'),expectedRevision:created.rule.revision,versionId:created.version.versionId,previewToken:preview.previewToken});assertDenied(activation,409);assert.deepEqual(await content(c),before);assert.equal(expectStatus(await c.get(`/automations/${created.rule.ruleId}`),200).rule.enabled,false);
            await c.lifecycle('explicit','restore');await c.activate(created);assert.equal(expectStatus(await c.get(`/automations/${created.rule.ruleId}`),200).diagnostics.length,0);
        });
    } finally {await s.close();}
    finish(results);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
