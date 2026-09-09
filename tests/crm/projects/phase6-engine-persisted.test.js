'use strict';
const assert = require('node:assert/strict');
const { bootSuite, project, definition, notify, createNode, latch, expectStatus, caseRun, finish } = require('./phase6-test-helpers');

async function main() {
    const s=await bootSuite();const results=[];const run=(name,fn)=>caseRun(name,fn,results);
    async function admit(c,p,event){await p.processEvent(event);const rows=(await c.rows('runs')).filter(r=>r.eventId===event);assert.ok(rows.length);return rows;}
    async function complete(c,p,rows){for(const row of rows)await p.processRun(row.runId);for(const row of rows)assert.equal((await c.rows('runs')).find(r=>r.runId===row.runId).state,'completed');}
    async function generated(c,title){return (await c.projectRef.collection('tasks').get()).docs.filter(d=>d.data().title===title);}
    try {
        await run('immutable A-B-C snapshot and V1 survive candidate save and V2 activation',async()=>{
            const c=await project(s,'immutable');await c.task('subject',{ownerUid:c.uids.editor});const v1=await c.rule(definition([notify('n','VERSION_ONE')],undefined,{field:'status',operator:'equals',value:'done'}));
            const e=await c.edit('subject',{status:'done'});await c.edit('subject',{status:'blocked'});
            const original=(await s.db.collection('crmProjectEvents').doc(e).get()).data();assert.equal(original.semantic.changes.find(x=>x.taskId==='subject').after.status,'done');assert.equal(original.semantic.ruleVersions[0].versionId,v1.version.versionId);
            const v2=expectStatus(await c.send(`/automations/${v1.rule.ruleId}/versions`,{operationId:c.op('version'),expectedRevision:v1.rule.revision,definition:definition([notify('n','VERSION_TWO')]),actorUid:c.uids.owner}),200);await c.activate(v2);
            const p=s.processor();const rows=await admit(c,p,e);assert.equal(rows.length,1);assert.equal(rows[0].versionId,v1.version.versionId);await complete(c,p,rows);
            const notes=await c.rows('notifications');assert.equal(notes.length,1);assert.equal(notes[0].message,'VERSION_ONE');
            const again=(await s.db.collection('crmProjectEvents').doc(e).get()).data();assert.deepEqual(again.semantic,original.semantic);
        });
        await run('activation and command race captures one coherent committed version',async()=>{
            const c=await project(s,'activation-race');await c.task('subject',{ownerUid:c.uids.editor});const v1=await c.rule(definition([notify('n','ONE')]));
            const v2=expectStatus(await c.send(`/automations/${v1.rule.ruleId}/versions`,{operationId:c.op('v2'),expectedRevision:v1.rule.revision,definition:definition([notify('n','TWO')]),actorUid:c.uids.owner}),200);
            const preview=expectStatus(await c.send(`/automations/${v1.rule.ruleId}/preview`,{versionId:v2.version.versionId,sampleTaskId:'subject'}),200);
            const op=c.op('raced-edit');const [activation,edit]=await Promise.all([c.send(`/automations/${v1.rule.ruleId}/activate`,{operationId:c.op('activate-race'),expectedRevision:v2.rule.revision,versionId:v2.version.versionId,previewToken:preview.previewToken}),c.send('/tasks/subject',{operationId:op,expectedRevision:(await c.taskData('subject')).revision,status:'done'},'owner','PATCH')]);
            expectStatus(edit,200);assert.ok([200,409].includes(activation.status));
            const event=(await s.db.collection('crmProjectEvents').doc(op).get()).data();assert.equal(event.semantic.ruleVersions.length,1);const captured=event.semantic.ruleVersions[0].versionId;assert.ok([v1.version.versionId,v2.version.versionId].includes(captured));if(activation.status===409)assert.equal(captured,v1.version.versionId);
            const p=s.processor();await complete(c,p,await admit(c,p,op));const notes=await c.rows('notifications');assert.equal(notes.length,1);assert.equal(notes[0].message,captured===v1.version.versionId?'ONE':'TWO');
        });
        for(const crashPoint of ['afterPrepared','afterEffect'])await run(`${crashPoint} restart exact-once two equal task actions and two equal notification actions`,async()=>{
            const c=await project(s,`crash-${crashPoint.toLowerCase()}`);await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([createNode('make1','Equal task'),createNode('make2','Equal task'),notify('notify1','Equal message'),notify('notify2','Equal message')]));const event=await c.edit('subject',{status:'done'});
            let injected=false;const first=s.processor('crashing',{[crashPoint]:async()=>{if(!injected){injected=true;throw new Error('INJECTED_CRASH');}}});const rows=await admit(c,first,event);
            await assert.rejects(first.processRun(rows[0].runId),/INJECTED_CRASH/);assert.equal((await c.rows('runs'))[0].state,'running');
            const tasksBefore=await generated(c,'Equal task');assert.equal(tasksBefore.length,crashPoint==='afterEffect'?1:0);
            s.advance(61000);const second=s.processor('restarted');await Promise.all([second.processEvent(event),s.processor('duplicate').processEvent(event)]);assert.equal((await c.rows('runs')).length,1);
            await complete(c,second,rows);assert.equal((await generated(c,'Equal task')).length,2);assert.equal((await c.rows('notifications')).filter(n=>n.category==='automation').length,2);
            const journals=await c.rows('journals');assert.equal(journals.length,4);assert.equal(new Set(journals.map(j=>j.path)).size,4);assert.ok(journals.every(j=>j.state==='committed'));
            const operations=(await c.rows('crmProjectOperations')).filter(o=>o.origin==='automation');assert.equal(operations.length,2);const events=(await c.rows('crmProjectEvents')).filter(e=>e.origin==='automation');assert.equal(events.length,2);for(const op of operations)assert.ok(events.some(e=>e.operationId===op.operationId));
        });
        await run('expired stale worker cannot write after takeover',async()=>{
            const c=await project(s,'lease');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([createNode('make','Lease task')]));const event=await c.edit('subject',{status:'done'});const entered=latch(),release=latch();const a=s.processor('stale',{beforeEffect:async()=>{entered.release();await release.promise;}});const rows=await admit(c,a,event);const work=a.processRun(rows[0].runId);
            try{await Promise.race([entered.promise,work.then(()=>{throw new Error('Worker finished before the required effect barrier');})]);s.advance(61000);await complete(c,s.processor('new-owner'),rows);}finally{release.release();await work;}
            assert.equal((await generated(c,'Lease task')).length,1);assert.equal((await c.rows('runs'))[0].effectCount,1);assert.equal((await c.rows('journals')).length,1);
        });
        await run('notify commit before run acknowledgement reconciles one delivery and one effect',async()=>{
            const c=await project(s,'notify-crash');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([notify('first','Exactly once')]));const event=await c.edit('subject',{status:'done'});let crashed=false;
            const first=s.processor('notify-crashed',{afterEffect:async()=>{if(!crashed){crashed=true;throw new Error('NOTIFY_COMMITTED_CRASH');}}});const rows=await admit(c,first,event);await assert.rejects(first.processRun(rows[0].runId),/NOTIFY_COMMITTED_CRASH/);assert.equal((await c.rows('notifications')).length,1);assert.equal((await c.rows('journals'))[0].state,'committed');
            s.advance(61000);await complete(c,s.processor('notify-restart'),rows);assert.equal((await c.rows('notifications')).length,1);assert.equal((await c.rows('runs'))[0].effectCount,1);
        });
        await run('more than forty matched candidates drain event fanout without missing or duplicate runs',async()=>{
            const c=await project(s,'fanout');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([notify('n','FANOUT')]));const ids=[];
            for(let i=0;i<45;i++){const id=`batch-${i}`;await c.task(id,{ownerUid:c.uids.editor});ids.push(id);}
            const operationId=c.op('bulk');const changes=[];for(const taskId of ids)changes.push({taskId,expectedRevision:(await c.taskData(taskId)).revision,patch:{status:'done'}});
            expectStatus(await c.send('/tasks/bulk',{operationId,changes}),200);const p=s.processor();const first=await p.processEvent(operationId);assert.equal(first.hasMore,true);assert.equal((await c.rows('runs')).length,40);
            let next=first;let batches=0;while(next.hasMore){assert.ok(++batches<5);next=await p.processEvent(operationId);}await p.processEvent(operationId);const rows=(await c.rows('runs')).filter(r=>r.eventId===operationId);assert.equal(rows.length,45);assert.deepEqual(rows.map(r=>r.taskId).sort(),ids.sort());assert.equal(new Set(rows.map(r=>r.runId)).size,45);await complete(c,p,rows);assert.equal((await c.rows('notifications')).filter(n=>n.category==='automation').length,45);
        });
        for(const change of ['revoke','disable'])await run(`current ${change} between preparation and canonical effect blocks writes`,async()=>{
            const c=await project(s,`authority-${change}`);await c.task('subject',{ownerUid:c.uids.editor});const rule=await c.rule(definition([createNode('make','Forbidden effect')]));const event=await c.edit('subject',{status:'done'});const member=(await c.memberRef('owner').get()).data();
            const p=s.processor(`worker-${change}`,{beforeEffect:async()=>{if(change==='revoke')await c.memberRef('owner').update({active:false});else expectStatus(await c.send(`/automations/${rule.rule.ruleId}`,{operationId:c.op('disable'),expectedRevision:rule.rule.revision,enabled:false},'owner','PATCH'),200);}});
            try{const rows=await admit(c,p,event);await p.processRun(rows[0].runId);const stored=(await c.rows('runs'))[0];assert.ok(['failed','canceled'].includes(stored.state));assert.ok(stored.errorCode);assert.equal((await generated(c,'Forbidden effect')).length,0);assert.equal((await c.rows('crmProjectOperations')).filter(o=>o.origin==='automation').length,0);}finally{await c.memberRef('owner').set(member);}
        });
        await run('transferred designated actor applies only to new version; revoked old actor cannot execute queued run',async()=>{
            const c=await project(s,'actor-transfer');await c.task('subject',{ownerUid:c.uids.viewer});expectStatus(await c.send(`/members/${c.uids.editor}`,{role:'Owner'},'owner','PATCH'),200);
            const old=await c.rule(definition([notify('n','OLD_ACTOR')]));const oldEvent=await c.edit('subject',{status:'done'});const originalVersion=(await c.rows('versions')).find(v=>v.versionId===old.version.versionId);
            const next=expectStatus(await c.send(`/automations/${old.rule.ruleId}/versions`,{operationId:c.op('transfer'),expectedRevision:old.rule.revision,definition:definition([notify('n','NEW_ACTOR')]),actorUid:c.uids.editor}),200);await c.activate(next);
            await c.edit('subject',{status:'not_started'},'editor');const nextEvent=await c.edit('subject',{status:'done'},'editor');const p=s.processor();await p.processEvent(oldEvent);await p.processEvent(nextEvent);const rows=await c.rows('runs');assert.equal(rows.length,2);assert.equal(rows.find(r=>r.eventId===oldEvent).actorUid,c.uids.owner);assert.equal(rows.find(r=>r.eventId===nextEvent).actorUid,c.uids.editor);
            const member=(await c.memberRef('owner').get()).data();try{await c.memberRef('owner').update({active:false});for(const row of rows)await p.processRun(row.runId);const stored=await c.rows('runs');assert.equal(stored.find(r=>r.eventId===oldEvent).state,'failed');assert.equal(stored.find(r=>r.eventId===nextEvent).state,'completed');assert.deepEqual((await c.rows('notifications')).map(n=>n.message),['NEW_ACTOR']);assert.deepEqual((await c.rows('versions')).find(v=>v.versionId===old.version.versionId),originalVersion);}finally{await c.memberRef('owner').set(member);}
        });
        await run('repeated pre-effect crashes reach a visible bounded failure without effects or lost run',async()=>{
            const c=await project(s,'crash-exhaustion');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([createNode('make','Never committed')]));const event=await c.edit('subject',{status:'done'});const p=s.processor('always-crash',{afterPrepared:async()=>{throw new Error('REPEATED_CRASH');}});const rows=await admit(c,p,event);
            for(let i=0;i<5;i++){await assert.rejects(p.processRun(rows[0].runId),/REPEATED_CRASH/);assert.equal((await c.rows('runs'))[0].state,'running');assert.equal((await generated(c,'Never committed')).length,0);s.advance(61000);}
            await s.processor('exhausted-restart').processRun(rows[0].runId);const stored=(await c.rows('runs'))[0];assert.equal(stored.state,'failed');assert.equal(stored.errorCode,'ATTEMPT_LIMIT');assert.equal(stored.attempts,5);assert.equal(stored.effectCount,0);assert.equal(stored.lease,null);assert.equal((await c.rows('journals')).length,1);assert.equal((await c.rows('crmProjectOperations')).filter(o=>o.origin==='automation').length,0);await p.processEvent(event);assert.equal((await c.rows('runs')).length,1);assert.equal((await c.rows('runs'))[0].state,'failed');
        });
        await run('seven sequential delays resume normally; branch after delay observes fresh task',async()=>{
            const c=await project(s,'delays');await c.task('subject',{ownerUid:c.uids.editor});const steps=Array.from({length:7},(_,i)=>({nodeId:`delay${i}`,type:'delay',payload:{durationMs:1000}}));steps.push({nodeId:'choose',type:'if',condition:{field:'status',operator:'equals',value:'blocked'},then:[notify('fresh','FRESH')],else:[notify('stale','STALE')]});await c.rule(definition(steps));const event=await c.edit('subject',{status:'done'});let p=s.processor('delay-first');const rows=await admit(c,p,event);
            for(let i=0;i<7;i++){await p.processRun(rows[0].runId);assert.equal((await c.rows('runs'))[0].state,'waiting');assert.equal((await c.rows('notifications')).length,0);s.advance(1000);p=s.processor(`delay-restart-${i}`);}
            await c.edit('subject',{status:'blocked'});await complete(c,p,rows);assert.equal((await c.rows('notifications'))[0].message,'FRESH');assert.equal((await c.rows('journals')).find(j=>j.type==='if').choice,'then');
        });
        await run('typed snapshot condition and all canonical action kinds preserve tree/value semantics',async()=>{
            const c=await project(s,'typed-actions');await c.task('ancestor');await c.task('subject',{parentTaskId:'ancestor',ownerUid:c.uids.editor});
            expectStatus(await c.send('/columns',{operationId:c.op('column'),columnId:'amount',type:'number',label:'Amount',expectedSchemaRevision:0,index:0}),200);
            await c.edit('subject',{values:{amount:5}});
            const steps=[{nodeId:'set',type:'set_field',payload:{patch:{values:{amount:12}}}},{nodeId:'assign',type:'assign',payload:{ownerUid:c.uids.editor,assigneeUids:[c.uids.viewer]}},{nodeId:'move',type:'move_section',payload:{sectionId:'s2'}},{nodeId:'child',type:'create_task',payload:{sectionId:'s2',parent:'trigger_task',task:{title:'Generated child'}}},{nodeId:'branch',type:'if',condition:{field:{columnId:'amount'},operator:'less_than',value:10},then:[notify('snapshot','SNAPSHOT')],else:[notify('wrong','WRONG_CURRENT')]}];
            await c.rule(definition(steps,undefined,{all:[{field:{columnId:'amount'},operator:'greater_or_equal',value:5},{not:{field:'status',operator:'equals',value:'blocked'}}]}));
            const event=await c.edit('subject',{status:'done'});const p=s.processor();await complete(c,p,await admit(c,p,event));const stored=await c.taskData('subject');assert.equal(stored.values.amount,12);assert.equal(stored.parentTaskId,null);assert.equal(stored.sectionId,'s2');assert.deepEqual(stored.assigneeUids,[c.uids.viewer]);
            const children=await generated(c,'Generated child');assert.equal(children.length,1);assert.equal(children[0].data().parentTaskId,'subject');assert.equal((await c.rows('notifications')).filter(n=>n.category==='automation')[0].message,'SNAPSHOT');
        });
        await run('future waiting rows do not starve a later ready continuation in bounded batches',async()=>{
            const c=await project(s,'fair-batch');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([{nodeId:'delay',type:'delay',payload:{durationMs:1000}},notify('notify','FAIR')]));const p=s.processor('fair');
            for(let i=0;i<4;i++){const id=`subject-${i}`;await c.task(id,{ownerUid:c.uids.editor});const e=await c.edit(id,{status:'done'});const rows=await admit(c,p,e);await p.processRun(rows[0].runId);}
            const waiting=(await c.rows('runs')).sort((a,b)=>a.id.localeCompare(b.id));assert.equal(waiting.length,4);
            // Persisted scheduler fixture: first rows are genuinely future work;
            // later row is due now. Effects still execute through canonical APIs.
            for(let i=0;i<waiting.length;i++)await s.db.collection('crmProjectAutomationRuns').doc(waiting[i].id).update({resumeAt:new Date(s.now().getTime()+(i===3?-1:3600000)).toISOString()});
            await p.processBatch({limit:2});
            const ready=(await c.rows('runs')).find(r=>r.id===waiting[3].id);assert.equal(ready.state,'completed');assert.equal((await c.rows('notifications')).filter(n=>n.category==='automation').length,1);assert.ok((await c.rows('runs')).filter(r=>r.id!==ready.id).every(r=>r.state==='waiting'));
        });
        await run('held running rows do not starve a later expired lease',async()=>{
            const c=await project(s,'fair-running');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([createNode('make','Recovered lease')]));const crashing=s.processor('held',{afterPrepared:async()=>{throw new Error('HOLD_RUN');}});
            // Prepare all effects against one unchanged structure revision. Task
            // creation after preparation would correctly invalidate old payloads.
            for(let i=0;i<4;i++)await c.task(`held-${i}`,{ownerUid:c.uids.editor});
            for(let i=0;i<4;i++){const event=await c.edit(`held-${i}`,{status:'done'});const rows=await admit(c,crashing,event);await assert.rejects(crashing.processRun(rows[0].runId),/HOLD_RUN/);}
            const rows=(await c.rows('runs')).sort((a,b)=>a.id.localeCompare(b.id));for(let i=0;i<rows.length;i++)await s.db.collection('crmProjectAutomationRuns').doc(rows[i].id).update({'lease.expiresAt':new Date(s.now().getTime()+(i===3?-1:3600000)).toISOString()});
            const p=s.processor('fair-running-resumer');await p.processBatch({limit:2});assert.equal((await c.rows('runs')).find(r=>r.id===rows[3].id).state,'completed');assert.equal((await generated(c,'Recovered lease')).length,1);assert.ok((await c.rows('runs')).filter(r=>r.id!==rows[3].id).every(r=>r.state==='running'));
        });
        await run('due generations distinguish A-B-A clear Undo and title-only edits, no retrospective activation',async()=>{
            s.setTime('2026-09-08T01:59:59Z');const c=await project(s,'due-generations');await c.task('subject',{ownerUid:c.uids.editor,dueDate:'2026-09-08'});await c.rule(definition([notify('due','DUE')],{type:'due_date',time:'09:00',offsetDays:0}));const p=s.processor();const first=(await c.taskData('subject')).dueGeneration;assert.ok(Number.isSafeInteger(first));await p.processDue(c.projectId,'subject');assert.equal((await c.rows('occurrences')).length,0);
            await c.edit('subject',{title:'Only title'});assert.equal((await c.taskData('subject')).dueGeneration,first);await c.edit('subject',{dueDate:'2026-09-09'});await c.edit('subject',{dueDate:'2026-09-08'});assert.equal((await c.taskData('subject')).dueGeneration,first+2);
            s.setTime('2026-09-08T02:00:00Z');await p.processDue(c.projectId,'subject');await p.processDue(c.projectId,'subject');await complete(c,p,await c.rows('runs'));assert.equal((await c.rows('notifications')).length,2);
            const clear=await c.edit('subject',{dueDate:null});assert.equal((await c.taskData('subject')).dueGeneration,first+3);await p.processDue(c.projectId,'subject');assert.equal((await c.rows('notifications')).length,2);
            expectStatus(await c.send(`/operations/${clear}/undo`,{operationId:c.op('undo-clear')}),200);assert.equal((await c.taskData('subject')).dueGeneration,first+4);
            await p.processDue(c.projectId,'subject');await complete(c,p,(await c.rows('runs')).filter(r=>r.state==='queued'));assert.equal((await c.rows('notifications')).length,4);
            await c.lifecycle('subject','archive');await p.processDue(c.projectId,'subject');await c.lifecycle('subject','restore');await p.processDue(c.projectId,'subject');assert.equal((await c.rows('notifications')).length,4);
            await c.task('late',{ownerUid:c.uids.editor,dueDate:'2026-09-07'});await p.processDue(c.projectId,'late');assert.equal((await c.rows('runs')).filter(r=>r.taskId==='late').length,0);
        });
        for(const invalidate of ['due-edit','ancestor-archive'])await run(`due trigger ${invalidate} inside effect boundary blocks a DIFFERENT task target`,async()=>{
            s.setTime('2026-09-08T01:00:00Z');const c=await project(s,`due-fence-${invalidate}`);await c.task('ancestor');await c.task('subject',{parentTaskId:'ancestor',ownerUid:c.uids.editor,dueDate:'2026-09-08'});await c.task('other',{title:'Unchanged'});await c.rule(definition([{nodeId:'change',type:'set_field',payload:{target:{taskId:'other'},patch:{title:'ILLEGAL'}}}],{type:'due_date',time:'09:00'}));s.setTime('2026-09-08T02:00:00Z');
            const p=s.processor(`fence-${invalidate}`,{beforeEffect:async()=>{if(invalidate==='due-edit')await c.edit('subject',{dueDate:'2026-09-09'});else await c.lifecycle('ancestor','archive');}});await p.processDue(c.projectId,'subject');const rows=await c.rows('runs');assert.equal(rows.length,1);await p.processRun(rows[0].runId);assert.equal((await c.taskData('other')).title,'Unchanged');assert.ok(['failed','canceled'].includes((await c.rows('runs'))[0].state));assert.equal((await c.rows('crmProjectOperations')).filter(o=>o.origin==='automation').length,0);
        });
        await run('inactive-at-firing occurrence is durably canceled across restore',async()=>{
            s.setTime('2026-09-08T01:00:00Z');const c=await project(s,'due-inactive');await c.task('ancestor');await c.task('subject',{parentTaskId:'ancestor',ownerUid:c.uids.editor,dueDate:'2026-09-08'});await c.rule(definition([notify('n')],{type:'due_date'}));await c.lifecycle('ancestor','archive');s.setTime('2026-09-08T02:00:00Z');const p=s.processor();await p.processDue(c.projectId,'subject');assert.ok((await c.rows('occurrences')).every(o=>o.state==='canceled'));await c.lifecycle('ancestor','restore');await p.processDue(c.projectId,'subject');assert.equal((await c.rows('runs')).length,0);assert.equal((await c.rows('notifications')).length,0);
        });
        await run('direct-child completion races, grandchild distinction, reopen and effective reparent transitions',async()=>{
            const c=await project(s,'children');await c.task('subject',{ownerUid:c.uids.editor});await c.task('a',{parentTaskId:'subject'});await c.task('b',{parentTaskId:'subject'});await c.task('grandchild',{parentTaskId:'a'});await c.task('empty',{ownerUid:c.uids.editor});await c.rule(definition([notify('n','CHILDREN')],{type:'all_direct_children_complete'}));const p=s.processor();
            const events=await Promise.all([c.edit('a',{status:'done'}),c.edit('b',{status:'done'})]);for(const e of events)await p.processEvent(e);let rows=await c.rows('runs');assert.equal(rows.length,1);assert.equal(rows[0].taskId,'subject');await complete(c,p,rows);assert.equal((await c.taskData('grandchild')).status,'not_started');
            await c.edit('b',{status:'not_started'});const done=await c.edit('b',{status:'done'});await p.processEvent(done);rows=(await c.rows('runs')).filter(r=>r.state==='queued');assert.equal(rows.length,1);await complete(c,p,rows);assert.equal((await c.rows('notifications')).length,2);
            await c.edit('b',{status:'not_started'});const op=c.op('move');expectStatus(await c.send('/tasks/b/move',{operationId:op,parentTaskId:null,sectionId:'s2',expectedRevision:(await c.taskData('b')).revision,expectedStructureRevision:(await c.projectData()).structureRevision}),200);await p.processEvent(op);rows=(await c.rows('runs')).filter(r=>r.state==='queued');assert.equal(rows.length,1);assert.equal(rows[0].taskId,'subject');await complete(c,p,rows);
            assert.ok((await c.rows('runs')).every(r=>r.taskId!=='empty'));assert.equal((await c.rows('notifications')).length,3);
            const back=c.op('reparent-back');expectStatus(await c.send('/tasks/b/move',{operationId:back,parentTaskId:'subject',expectedRevision:(await c.taskData('b')).revision,expectedStructureRevision:(await c.projectData()).structureRevision}),200);await p.processEvent(back);assert.equal((await c.rows('runs')).length,3);
            const archived=await c.lifecycle('b','archive');await p.processEvent(archived);rows=(await c.rows('runs')).filter(r=>r.state==='queued');assert.equal(rows.length,1);await complete(c,p,rows);
            const restored=await c.lifecycle('b','restore');await p.processEvent(restored);assert.equal((await c.rows('runs')).length,4);const redone=await c.edit('b',{status:'done'});await p.processEvent(redone);rows=(await c.rows('runs')).filter(r=>r.state==='queued');assert.equal(rows.length,1);await complete(c,p,rows);assert.equal((await c.rows('notifications')).length,5);
        });
        await run('cyclic rule ancestry halts but independent later manual event still works',async()=>{
            const c=await project(s,'loops');await c.task('subject',{ownerUid:c.uids.editor});await c.rule(definition([{nodeId:'block',type:'set_field',payload:{patch:{status:'blocked'}}}],{type:'status_changed',to:'done'}));await c.rule(definition([{nodeId:'done',type:'set_field',payload:{patch:{status:'done'}}}],{type:'status_changed',to:'blocked'}));const p=s.processor();const initial=await c.edit('subject',{status:'done'});await p.processEvent(initial);
            for(let pass=0;pass<5;pass++){for(const row of (await c.rows('runs')).filter(r=>r.state==='queued'))await p.processRun(row.runId);for(const e of (await c.rows('crmProjectEvents')).filter(e=>e.automationStatus==='pending'))await p.processEvent(e.eventId);}
            const rows=await c.rows('runs');assert.ok(rows.some(r=>r.state==='failed'&&r.errorCode==='AUTOMATION_CYCLE'));assert.ok(rows.length<=4);const before=rows.length;
            await c.edit('subject',{status:'not_started'});const manual=await c.edit('subject',{status:'done'});await p.processEvent(manual);assert.ok((await c.rows('runs')).length>before);assert.ok((await c.rows('runs')).some(r=>r.eventId===manual&&r.state==='queued'));
        });
    }finally{await s.close();}
    finish(results);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
