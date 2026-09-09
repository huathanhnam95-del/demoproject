'use strict';
const assert = require('node:assert/strict');
const { bootSuite, project, definition, notify, createNode, expectStatus, assertDenied, notifications, caseRun, finish, noSecrets, createColumn, directFirestoreRequest, request, COLLECTIONS } = require('./phase6-test-helpers');

async function main() {
    const s = await bootSuite(); const results=[]; const run=(name,fn)=>caseRun(name,fn,results);
    try {
        await run('rule APIs enforce current Owner, strict DSL, typed literals, references and structural limits',async()=>{
            const c=await project(s,'api-definition'); await c.task('subject',{ownerUid:c.uids.editor});
            const good=definition([notify('n')]);
            for(const [role,status] of [['editor',403],['viewer',403],['admin@demo.crm-projects.test',404]]) assertDenied(await c.send('/automations',{operationId:c.op('denied'),title:'Denied',definition:good},role),status);
            await createColumn(c,'number',{type:'number',label:'Amount'});
            const invalid=[{...good,unknown:true},{...good,schemaVersion:2},{...good,trigger:{type:'made_up'}},definition([notify('same'),notify('same')]),definition([{nodeId:'script',type:'script',payload:{code:'x'}}]),definition([{nodeId:'n',type:'assign',payload:{ownerUid:c.uids.editor,assigneeUids:[c.uids.editor]}}]),definition([{nodeId:'n',type:'set_field',payload:{patch:{values:{number:'not a number'}}}}]),definition([{nodeId:'n',type:'set_field',payload:{target:{taskId:'missing-cross-project'},patch:{title:'No'}}}]),definition([{nodeId:'n',type:'move_section',payload:{sectionId:'missing-section'}}]),definition([notify('n','x',[c.uids.unauthorized])]),definition(Array.from({length:65},(_,i)=>notify(`n${i}`))),definition([{nodeId:'delay',type:'delay',payload:{durationMs:30*86400000+1}}]),definition([{nodeId:'d1',type:'delay',payload:{durationMs:20*86400000}},{nodeId:'d2',type:'delay',payload:{durationMs:20*86400000}}]),definition([notify('n')],undefined,{field:{columnId:'number'},operator:'equals',value:'wrong'})];
            let condition={field:'status',operator:'equals',value:'done'}; for(let i=0;i<9;i++)condition={not:condition}; invalid.push(definition([notify('n')],undefined,condition)); invalid.push({...good,steps:[notify('n','x'.repeat(66000))]});
            for(const value of invalid) {const before=(await c.rows('rules')).length;const response=await c.send('/automations',{operationId:c.op('invalid'),title:'Invalid',definition:value});assert.ok([400,403,404,409,413].includes(response.status),JSON.stringify(response.body));assert.equal((await c.rows('rules')).length,before);}
            for(const type of ['task_created','status_changed','assignment_changed','due_date','all_direct_children_complete']) expectStatus(await c.send('/automations',{operationId:c.op(type),title:type,definition:definition([notify('n')],{type})}),200);
        });
        await run('immutable versions, exact retries, explicit activation and stale preview/reference fences',async()=>{
            const c=await project(s,'api-versions');await c.task('subject',{ownerUid:c.uids.editor});
            const input={operationId:c.op('create'),title:'Versioned',definition:definition([notify('n','V1')])};
            const one=expectStatus(await c.send('/automations',input),200);assert.deepEqual(expectStatus(await c.send('/automations',input),200),one);assert.equal((await c.rows('versions')).length,1);assert.equal(one.rule.enabled,false);
            assertDenied(await c.send('/automations',{...input,title:'Changed'}),409);
            const preview=expectStatus(await c.send(`/automations/${one.rule.ruleId}/preview`,{versionId:one.version.versionId,sampleTaskId:'subject'}),200);
            const before=await c.taskData('subject');assert.equal((await c.rows('runs')).length,0);assert.deepEqual(await c.taskData('subject'),before);
            await c.edit('subject',{title:'Reference changed'});
            assertDenied(await c.send(`/automations/${one.rule.ruleId}/activate`,{operationId:c.op('stale'),expectedRevision:one.rule.revision,versionId:one.version.versionId,previewToken:preview.previewToken}),409);
            const active=await c.activate(one);const oldVersion=(await c.rows('versions')).find(v=>v.versionId===one.version.versionId);
            const two=expectStatus(await c.send(`/automations/${one.rule.ruleId}/versions`,{operationId:c.op('v2'),expectedRevision:active.rule.revision,definition:definition([notify('n','V2')]),actorUid:c.uids.owner}),200);
            assert.equal(two.rule.enabled,true);assert.equal(two.rule.currentVersion,one.version.versionId);assert.equal(two.rule.candidateVersion,two.version.versionId);
            assert.deepEqual((await c.rows('versions')).find(v=>v.versionId===one.version.versionId),oldVersion);
            const copy=expectStatus(await c.send(`/automations/${one.rule.ruleId}/duplicate`,{operationId:c.op('copy'),expectedRevision:two.rule.revision}),200);assert.notEqual(copy.rule.ruleId,one.rule.ruleId);assert.equal(copy.rule.enabled,false);assert.equal(copy.version.actorUid,c.uids.owner);
            const activeTwo=await c.activate(two);const disabled=expectStatus(await c.send(`/automations/${one.rule.ruleId}`,{operationId:c.op('disable'),expectedRevision:activeTwo.rule.revision,enabled:false},'owner','PATCH'),200);assert.equal(disabled.rule.enabled,false);
            assertDenied(await c.send(`/automations/${one.rule.ruleId}`,{operationId:c.op('stale-meta'),expectedRevision:1,title:'Stale'},'owner','PATCH'),409);
            const saved=(await c.memberRef('owner').get()).data();try{await c.memberRef('owner').update({active:false});assertDenied(await c.send('/automations',input),404);}finally{await c.memberRef('owner').set(saved);}
        });
        await run('duplicate and disabled draft lifecycle keep fresh version pointers without inherited activation',async()=>{
            const c=await project(s,'candidate-lifecycle');await c.task('subject',{ownerUid:c.uids.editor});
            const v1=await c.rule(definition([notify('n','V1')]));const ruleId=v1.rule.ruleId;
            const v2=expectStatus(await c.send(`/automations/${ruleId}/versions`,{operationId:c.op('candidate'),expectedRevision:v1.rule.revision,definition:definition([notify('n','V2')]),actorUid:c.uids.owner}),200);
            const sourceBefore=(await c.rows('rules')).find(r=>r.ruleId===ruleId);const versionsBefore=await c.rows('versions');const registryBefore=(await s.db.collection(COLLECTIONS.registries).doc(c.projectId).get()).data();
            const copyInput={operationId:c.op('duplicate'),expectedRevision:v2.rule.revision};const copy=expectStatus(await c.send(`/automations/${ruleId}/duplicate`,copyInput),200);
            assert.deepEqual(expectStatus(await c.send(`/automations/${ruleId}/duplicate`,copyInput),200),copy);
            const copyGet=expectStatus(await c.get(`/automations/${copy.rule.ruleId}`),200);assert.equal(copyGet.rule.enabled,false);assert.equal(copyGet.version.versionId,copy.version.versionId);assert.equal(copyGet.rule.currentVersion,copy.version.versionId);assert.equal(copyGet.version.ruleId,copy.rule.ruleId);assert.notEqual(copy.version.versionId,v1.version.versionId);assert.deepEqual(copyGet.version.definition,v1.version.definition);assert.equal(copyGet.rule.candidateVersion??null,null);assert.equal(copyGet.rule.activatedAt??null,null);
            assert.deepEqual((await c.rows('rules')).find(r=>r.ruleId===ruleId),sourceBefore);assert.equal((await c.rows('versions')).length,versionsBefore.length+1);
            const registryAfterCopy=(await s.db.collection(COLLECTIONS.registries).doc(c.projectId).get()).data();assert.deepEqual(registryAfterCopy.versions,registryBefore.versions);assert.equal(registryAfterCopy.versions.find(r=>r.ruleId===ruleId).versionId,v1.version.versionId);assert.ok(!registryAfterCopy.versions.some(r=>r.ruleId===copy.rule.ruleId));
            const disabled=expectStatus(await c.send(`/automations/${ruleId}`,{operationId:c.op('disable'),expectedRevision:v2.rule.revision,enabled:false},'owner','PATCH'),200);
            const thirdInput={operationId:c.op('third'),expectedRevision:disabled.rule.revision,definition:definition([notify('n','V3')]),actorUid:c.uids.owner};const v3=expectStatus(await c.send(`/automations/${ruleId}/versions`,thirdInput),200);assert.deepEqual(expectStatus(await c.send(`/automations/${ruleId}/versions`,thirdInput),200),v3);
            const sourceGet=expectStatus(await c.get(`/automations/${ruleId}`),200);assert.equal(sourceGet.rule.enabled,false);assert.equal(sourceGet.rule.currentVersion,v3.version.versionId);assert.equal(sourceGet.rule.candidateVersion??null,null);assert.equal(sourceGet.version.versionId,v3.version.versionId);assert.deepEqual(sourceGet.version.definition,thirdInput.definition);assert.equal((await c.rows('versions')).length,versionsBefore.length+2);
            for(const old of versionsBefore)assert.deepEqual((await c.rows('versions')).find(v=>v.versionId===old.versionId),old);
            const registryFinal=(await s.db.collection(COLLECTIONS.registries).doc(c.projectId).get()).data();assert.ok(!registryFinal.versions.some(r=>r.ruleId===ruleId||r.ruleId===copy.rule.ruleId));
        });
        await run('activation preview expires, binds its Owner and rejects changed schema without partial activation',async()=>{
            const c=await project(s,'preview-fences');await c.task('subject',{ownerUid:c.uids.viewer});expectStatus(await c.send(`/members/${c.uids.editor}`,{role:'Owner'},'owner','PATCH'),200);
            const created=await c.createRule(definition([notify('n')]));const ruleId=created.rule.ruleId;const versionId=created.version.versionId;
            const preview=()=>c.send(`/automations/${ruleId}/preview`,{versionId,sampleTaskId:'subject'});
            const activate=(token,role='owner')=>c.send(`/automations/${ruleId}/activate`,{operationId:c.op('activation'),expectedRevision:created.rule.revision,versionId,previewToken:token},role);
            let token=expectStatus(await preview(),200).previewToken;assertDenied(await activate(token,'editor'),409);
            s.advance(15*60000+1);assertDenied(await activate(token),409);
            token=expectStatus(await preview(),200).previewToken;await createColumn(c,'new-field',{type:'text',label:'Changed schema'});assertDenied(await activate(token),409);
            const stored=expectStatus(await c.get(`/automations/${ruleId}`),200);assert.equal(stored.rule.enabled,false);assert.equal(stored.rule.revision,created.rule.revision);assert.equal((await c.rows('runs')).length,0);assert.equal((await c.rows('crmProjectOperations')).filter(o=>o.command==='automation_activate').length,0);
            await c.activate(created);assert.equal(expectStatus(await c.get(`/automations/${ruleId}`),200).rule.enabled,true);
        });
        await run('built-in assignment/discussion recipients, self suppression, edited mentions and immutable event privacy',async()=>{
            const c=await project(s,'api-notifications');const p=s.processor();await c.task('subject',{title:'PRIVATE_TASK_SENTINEL',ownerUid:c.uids.editor,assigneeUids:[c.uids.viewer]});
            const createEvent=`phase4-task-${c.projectId}-subject`;await p.processEvent(createEvent);await p.processEvent(createEvent);
            assert.equal((await notifications(s,c.projectId,'editor')).length,1);assert.equal((await notifications(s,c.projectId,'viewer')).length,1);assert.equal((await notifications(s,c.projectId,'owner')).length,0);
            const operationId=c.op('message');expectStatus(await c.send('/tasks/subject/discussion/messages',{operationId,messageId:'original',body:'PRIVATE_BODY_SENTINEL',mentions:[c.uids.editor]}),200);await p.processEvent(operationId);await p.processEvent(operationId);
            let editor=await notifications(s,c.projectId,'editor');assert.equal(editor.length,2);assert.equal((await notifications(s,c.projectId,'viewer')).length,2);
            const event=(await s.db.collection('crmProjectEvents').doc(operationId).get()).data();noSecrets(event,['PRIVATE_BODY_SENTINEL']);
            const reply=c.op('reply');expectStatus(await c.send('/tasks/subject/discussion/messages/original/replies',{operationId:reply,messageId:'reply',body:'Reply',mentions:[c.uids.editor]},'editor'),200);await p.processEvent(reply);
            assert.equal((await notifications(s,c.projectId,'owner')).length,1);assert.equal((await notifications(s,c.projectId,'editor')).length,2);assert.equal((await notifications(s,c.projectId,'viewer')).length,3);
            const edit=c.op('edit-message');expectStatus(await c.send('/tasks/subject/discussion/messages/original',{operationId:edit,expectedRevision:1,mentions:[c.uids.editor,c.uids.viewer]},'owner','PATCH'),200);await p.processEvent(edit);
            assert.equal((await notifications(s,c.projectId,'editor')).length,2);assert.equal((await notifications(s,c.projectId,'viewer')).length,4);
            editor=await notifications(s,c.projectId,'editor');const messageItem=editor.find(n=>n.category==='discussion');
            const target=expectStatus(await s.global(`/notifications/${messageItem.notificationId}/target`,'editor'),200);assert.equal(target.taskId,'subject');assert.equal(target.messageId,'original');
            for(let i=0;i<2;i++)expectStatus(await s.global(`/notifications/${messageItem.notificationId}`,'editor','PATCH',{read:true}),200);
            assert.equal((await notifications(s,c.projectId,'editor')).find(n=>n.notificationId===messageItem.notificationId).read,true);
            assertDenied(await s.global(`/notifications/${messageItem.notificationId}/target`,'owner'),404);
            assertDenied(await s.global(`/notifications/${messageItem.notificationId}`,'viewer','PATCH',{read:false}),404);
            expectStatus(await c.send('/tasks/subject/discussion/messages/original/moderate',{operationId:c.op('hide'),expectedRevision:2,action:'hide',reason:'Acceptance moderation'}),200);
            const hidden=(await notifications(s,c.projectId,'editor')).find(n=>n.notificationId===messageItem.notificationId);assert.equal(hidden.available,false);noSecrets(hidden,['PRIVATE_BODY_SENTINEL','PRIVATE_TASK_SENTINEL']);assert.equal(expectStatus(await s.global(`/notifications/${messageItem.notificationId}/target`,'editor'),200).available,false);
        });
        await run('preferences replacement/CAS, mute durable across redelivery and unmute',async()=>{
            const c=await project(s,'api-mute');await c.task('subject',{ownerUid:c.uids.editor});const p=s.processor();
            const before=expectStatus(await s.global('/notification-preferences','editor'),200);
            const muted=[{projectId:c.projectId,category:'assignment'},{projectId:c.projectId,category:'discussion'}];
            const saved=expectStatus(await s.global('/notification-preferences','editor','PATCH',{expectedRevision:before.revision,muted}),200);assert.deepEqual(saved.muted,muted);
            assertDenied(await s.global('/notification-preferences','editor','PATCH',{expectedRevision:before.revision,muted:[]}),409);
            assertDenied(await s.global('/notification-preferences','editor','PATCH',{expectedRevision:saved.revision,muted:[{projectId:c.projectId,category:'made_up'}]}),400);
            const event=`phase4-task-${c.projectId}-subject`;await p.processEvent(event);assert.equal((await notifications(s,c.projectId,'editor')).length,0);
            const cleared=expectStatus(await s.global('/notification-preferences','editor','PATCH',{expectedRevision:saved.revision,muted:[]}),200);assert.deepEqual(cleared.muted,[]);
            await p.processEvent(event);assert.equal((await notifications(s,c.projectId,'editor')).length,0);assert.ok((await c.rows('deliveries')).some(d=>d.state==='suppressed'));
            await c.edit('subject',{ownerUid:null});const assigned=await c.edit('subject',{ownerUid:c.uids.editor});await p.processEvent(assigned);assert.equal((await notifications(s,c.projectId,'editor')).length,1);
        });
        await run('notification tombstones, current membership/profile/Auth privacy and direct Firestore denial',async()=>{
            const c=await project(s,'api-privacy');await c.task('ancestor');await c.task('subject',{parentTaskId:'ancestor',title:'SECRET_OLD_LABEL',ownerUid:c.uids.editor});const p=s.processor();await p.processEvent(`phase4-task-${c.projectId}-subject`);
            const item=(await notifications(s,c.projectId,'editor'))[0];assert.ok(item);await c.lifecycle('ancestor','archive');
            const tombstone=(await notifications(s,c.projectId,'editor'))[0];assert.equal(tombstone.available,false);noSecrets(tombstone,['SECRET_OLD_LABEL']);assert.deepEqual(expectStatus(await s.global(`/notifications/${item.notificationId}/target`,'editor'),200),{success:true,available:false});
            const member=(await c.memberRef('editor').get()).data();try{await c.memberRef('editor').update({active:false});const feed=expectStatus(await s.global('/notifications','editor'),200);assert.ok(feed.items.every(n=>n.projectId!==c.projectId));assertDenied(await s.global(`/notifications/${item.notificationId}/target`,'editor'),404);assertDenied(await s.global(`/notifications/${item.notificationId}`,'editor','PATCH',{read:true}),404);}finally{await c.memberRef('editor').set(member);}
            const profileRef=s.db.collection('users').doc(c.uids.editor);const profile=(await profileRef.get()).data();try{await profileRef.update({accountStatus:'suspended'});assertDenied(await s.global('/notifications','editor'),403);}finally{await profileRef.set(profile);}
            const staleToken=await s.token('editor');try{await s.auth.updateUser(c.uids.editor,{disabled:true});const response=await request(s.server,'/api/projects/notifications',staleToken);assert.ok([401,403].includes(response.status));noSecrets(response.body,['SECRET_OLD_LABEL']);}finally{await s.auth.updateUser(c.uids.editor,{disabled:false});}
            const token=await s.token('editor');for(const collection of Object.values(COLLECTIONS)){const response=await directFirestoreRequest(`${collection}/arbitrary-protected-record`,token);assert.equal(response.status,403);}
        });
        await run('atomic bulk assignment rejection leaves no task, operation or semantic-event changes',async()=>{
            const c=await project(s,'bulk-rejection');await c.task('subject',{ownerUid:c.uids.owner,assigneeUids:[c.uids.editor]});await c.task('other');const before=await c.taskData('subject'),other=await c.taskData('other');const operationId=c.op('invalid-bulk');
            const response=await c.send('/tasks/bulk',{operationId,changes:[{taskId:'subject',expectedRevision:before.revision,patch:{ownerUid:c.uids.editor}},{taskId:'other',expectedRevision:other.revision,patch:{title:'Must roll back'}}]});
            assert.equal(response.status,400,JSON.stringify(response.body));assert.deepEqual(await c.taskData('subject'),before);assert.deepEqual(await c.taskData('other'),other);assert.equal((await s.db.collection('crmProjectOperations').doc(operationId).get()).exists,false);assert.equal((await s.db.collection('crmProjectEvents').doc(operationId).get()).exists,false);
        });
        await run('bounded notification pagination traverses a full revoked scan page without leaking labels',async()=>{
            const denied=await project(s,'feed-revoked');await denied.task('subject',{ownerUid:denied.uids.editor});const allowed=await project(s,'feed-allowed');await allowed.task('subject',{ownerUid:allowed.uids.editor,title:'Allowed label'});const batch=s.db.batch();
            for(let i=0;i<110;i++){const notificationId=`phase6-feed-${String(i).padStart(3,'0')}`;const blocked=i<105;batch.set(s.db.collection(COLLECTIONS.notifications).doc(notificationId),{notificationId,projectId:blocked?denied.projectId:allowed.projectId,taskId:'subject',messageId:null,recipientUid:allowed.uids.editor,category:'automation',message:blocked?'REVOKED_SECRET':'Allowed',createdAt:blocked?'2030-01-02T00:00:00Z':'2030-01-01T00:00:00Z',read:false});}await batch.commit();
            const member=(await denied.memberRef('editor').get()).data();try{await denied.memberRef('editor').update({active:false});const first=expectStatus(await s.global('/notifications?category=automation','editor'),200);assert.deepEqual(first.items,[]);assert.equal(first.hasMore,true);assert.ok(first.nextCursor);noSecrets(first,['REVOKED_SECRET']);const next=expectStatus(await s.global(`/notifications?category=automation&cursor=${encodeURIComponent(first.nextCursor)}`,'editor'),200);assert.equal(next.items.filter(n=>n.projectId===allowed.projectId).length,5);noSecrets(next,['REVOKED_SECRET']);const rows=await notifications(s,allowed.projectId,'editor');assert.equal(rows.length,5);noSecrets(rows,['REVOKED_SECRET']);}finally{await denied.memberRef('editor').set(member);}
        });
        await run('query filters reach older matches on first page and preserve tied cursors and fresh privacy',async()=>{
            const c=await project(s,`filter-${Date.now()}`), other=await project(s,`filter-other-${Date.now()}`);
            await c.task('subject',{title:'FILTER_PRIVATE_LABEL'});await other.task('subject');
            const batch=s.db.batch(), ids=[];
            for(let i=0;i<110;i++){
                const notificationId=`${c.projectId}-noise-${i}`;
                batch.set(s.db.collection(COLLECTIONS.notifications).doc(notificationId),{notificationId,projectId:other.projectId,taskId:'subject',recipientUid:c.uids.editor,category:'automation',read:true,createdAt:'2040-02-01T00:00:00.000Z',message:'noise'});
            }
            for(let i=0;i<7;i++){
                const notificationId=`${c.projectId}-match-${i}`;ids.push(notificationId);
                batch.set(s.db.collection(COLLECTIONS.notifications).doc(notificationId),{notificationId,projectId:c.projectId,taskId:'subject',recipientUid:c.uids.editor,category:'deadline',read:false,createdAt:'2040-01-01T00:00:00.000Z',message:'FILTER_PRIVATE_MESSAGE'});
            }
            await batch.commit();ids.sort().reverse();
            for(let mask=1;mask<8;mask++){
                const filters=new URLSearchParams({pageSize:'3'});if(mask&1)filters.set('projectId',c.projectId);if(mask&2)filters.set('category','deadline');if(mask&4)filters.set('unread','true');
                const first=expectStatus(await s.global(`/notifications?${filters}`,'editor'),200);
                assert.deepEqual(first.items.map(n=>n.notificationId),ids.slice(0,3),`first page combination ${mask}`);assert.ok(first.nextCursor);
            }
            const filters=new URLSearchParams({projectId:c.projectId,category:'deadline',unread:'true',pageSize:'3'});
            let page=expectStatus(await s.global(`/notifications?${filters}`,'editor'),200),seen=[],firstCursor=page.nextCursor;
            for(let count=0;;count++){
                assert.ok(count<4);seen.push(...page.items.map(n=>n.notificationId));if(!page.hasMore)break;
                filters.set('cursor',page.nextCursor);page=expectStatus(await s.global(`/notifications?${filters}`,'editor'),200);
            }
            assert.deepEqual(seen,ids);assert.equal(new Set(seen).size,7);
            for(const [key,value] of [['projectId',other.projectId],['category','assignment'],['unread','false']]){
                const wrong=new URLSearchParams({projectId:c.projectId,category:'deadline',unread:'true',cursor:firstCursor});wrong.set(key,value);assertDenied(await s.global(`/notifications?${wrong}`,'editor'),400);
            }
            expectStatus(await s.global(`/notifications/${ids[0]}`,'editor','PATCH',{read:true}),200);
            const read=expectStatus(await s.global(`/notifications?projectId=${c.projectId}&category=deadline&unread=false`,'editor'),200);assert.deepEqual(read.items.map(n=>n.notificationId),[ids[0]]);
            const unread=expectStatus(await s.global(`/notifications?projectId=${c.projectId}&category=deadline&unread=true`,'editor'),200);assert.equal(unread.items.length,6);assert.ok(unread.items.every(n=>!n.read));
            await c.lifecycle('subject','archive');const tombstones=expectStatus(await s.global(`/notifications?projectId=${c.projectId}&category=deadline&unread=true`,'editor'),200);assert.equal(tombstones.items.length,6);assert.ok(tombstones.items.every(n=>!n.available));noSecrets(tombstones,['FILTER_PRIVATE_LABEL','FILTER_PRIVATE_MESSAGE']);
            const member=(await c.memberRef('editor').get()).data();try{await c.memberRef('editor').update({active:false});assertDenied(await s.global(`/notifications?projectId=${c.projectId}&category=deadline`,'editor'),404);const feed=expectStatus(await s.global('/notifications?category=deadline&unread=true','editor'),200);assert.ok(feed.items.every(n=>n.projectId!==c.projectId));noSecrets(feed,['FILTER_PRIVATE_LABEL','FILTER_PRIVATE_MESSAGE']);}finally{await c.memberRef('editor').set(member);}
        });
        await run('Projects and automation flags pause without consuming queues while built-in notifications remain independent',async()=>{
            const c=await project(s,'api-flags');await c.task('subject',{ownerUid:c.uids.editor});const created=await c.createRule(definition([createNode('make')]));const p=s.processor();
            process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED='0';try{const preview=expectStatus(await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId:created.version.versionId,sampleTaskId:'subject'}),200);assertDenied(await c.send(`/automations/${created.rule.ruleId}/activate`,{operationId:c.op('disabled'),expectedRevision:created.rule.revision,versionId:created.version.versionId,previewToken:preview.previewToken}),409);}finally{process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED='1';}
            await c.activate(created);const event=await c.edit('subject',{status:'done'});process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED='0';try{await p.processEvent(event);assert.equal((await c.rows('runs')).length,0);assert.equal((await s.db.collection('crmProjectEvents').doc(event).get()).data().automationStatus,'pending');await p.processEvent(`phase4-task-${c.projectId}-subject`);assert.equal((await notifications(s,c.projectId,'editor')).length,1);}finally{process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED='1';}
            process.env.CRM_PROJECTS_ENABLED='0';try{await p.processEvent(event);assert.equal((await c.rows('runs')).length,0);}finally{process.env.CRM_PROJECTS_ENABLED='1';}
            await p.processEvent(event);const runs=await c.rows('runs');assert.equal(runs.length,1);await p.processRun(runs[0].runId);assert.equal((await c.rows('runs'))[0].state,'completed');
        });
    } finally {await s.close();}
    finish(results);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
