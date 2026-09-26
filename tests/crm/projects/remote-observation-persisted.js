'use strict';
const assert = require('node:assert/strict');
const h = require('./phase5-test-helpers');
const { createProjectsAccessService, memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
const { createProjectsChangeFeedService, shardFor, decodeCursor, LIMITS } = require('../../../functions/src/crm/projects/change-feed-service');
const { createTaskLinksService } = require('../../../functions/src/crm/projects/task-links-service');
const { createProjectsQueryService } = require('../../../functions/src/crm/projects/domain/query-service');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
async function main(){
    const projectId=`remote-persisted-${Date.now()}`; const c=await h.bootPhase5(projectId);const results=[];let sequence=0;
    const op=prefix=>`${projectId}-${prefix}-${++sequence}`;
    const accessService=createProjectsAccessService({db:c.db,auth:c.auth}); const command=createProjectsCommandService({db:c.db,accessService}); const feed=createProjectsChangeFeedService({db:c.db,accessService}); const query=createProjectsQueryService({db:c.db,accessService}); const identity={uid:c.uids.owner};
    const head=()=>feed.poll(identity,projectId);const changes=cursor=>feed.poll(identity,projectId,{cursor});
    const run=(operationId,execute)=>command.runCommand({actorUid:identity.uid,projectId,command:'remoteAcceptance',operationId,payload:{},execute:execute||(async()=>({result:{ok:true},affectedPaths:[`crmProjects/${projectId}/tasks/t`]}))});
    try{
        await h.task(c,'t',{title:'Initial'});
        await h.caseRun('one /open request returns the board and a cursor matching it; outsiders are refused',async()=>{
            const query=`/open?pageSize=200&filters=${encodeURIComponent(JSON.stringify({parentScope:'root'}))}&includeAncestorContext=true`;
            const opened=h.expectStatus(await c.get(query,'owner'),200);
            assert.equal(opened.project.id,projectId);assert.equal(opened.membership.role,'Owner');assert.ok(Array.isArray(opened.people));
            assert.ok(opened.page.tasks.some(task=>task.id==='t'));assert.equal(opened.project.crmLinks,undefined);
            assert.equal((await changes(opened.changes.cursor)).changes.length,0,'the cursor matches the returned board');
            await run(op('after-open'));assert.equal((await changes(opened.changes.cursor)).changes.length,1,'a later change is seen from the /open cursor');
            assert.ok([403,404].includes((await c.get(query,'unauthorized')).status),'non-members cannot open the board');
        },results);
        await h.caseRun('committed replay failure and prepared preview/apply have exact counter cardinality',async()=>{
            const before=await head();const operationId=op('single');await run(operationId);await run(operationId);await assert.rejects(run(op('failed'),async()=>{throw Error('failure');}));
            const preparedPayload={operationId:op('preview'),expectedRevision:(await c.revision()).revision,name:'Prepared rename'};
            await c.db.runTransaction(transaction=>command.prepareUpdateProject({transaction,actorUid:identity.uid,projectId,payload:preparedPayload}));
            let page=await changes(before.cursor);assert.equal(page.changes.length,1);
            const applyId=op('apply');await command.runCommand({actorUid:identity.uid,projectId,command:'applyAiDraft',operationId:applyId,payload:{},execute:async({transaction})=>(await command.prepareUpdateProject({transaction,actorUid:identity.uid,projectId,payload:preparedPayload})).flush()});
            page=await changes(page.cursor);assert.equal(page.changes.length,1);assert.equal((await c.db.collection('crmProjectEvents').doc(preparedPayload.operationId).get()).exists,false);assert.equal((await c.db.collection('crmProjectEvents').doc(applyId).get()).data().feedVersion,1);
        },results);
        await h.caseRun('different-shard delayed transaction A cannot disappear behind committed B',async()=>{
            const before=await head();const a=op('delayed-a');let b;do{b=op('b');}while(shardFor(a)===shardFor(b));const entered=deferred(),release=deferred();
            const pending=run(a,async()=>{entered.resolve();await release.promise;return{result:{a:true},affectedPaths:[`crmProjects/${projectId}/tasks/a`]};});
            await entered.promise;
            try{await run(b,async()=>({result:{b:true},affectedPaths:[`crmProjects/${projectId}/tasks/b`]}));const observed=await changes(before.cursor);assert.ok(observed.taskIds.includes('b'));assert.ok(!observed.taskIds.includes('a'));release.resolve();await pending;const late=await changes(observed.cursor);assert.ok(late.taskIds.includes('a'));}finally{release.resolve();await pending;}
        },results);
        await h.caseRun('same-shard concurrent commits serialize sequences without a gap',async()=>{
            const before=await head();const a=op('same-a');let b;do{b=op('same-b');}while(shardFor(a)!==shardFor(b));const entered=deferred(),release=deferred();let bFinished=false;
            const pendingA=run(a,async()=>{entered.resolve();await release.promise;return{result:{ok:true},affectedPaths:[]};});await entered.promise;const pendingB=run(b).then(()=>{bFinished=true;});
            try{await new Promise(resolve=>setTimeout(resolve,100));assert.equal(bFinished,false);}finally{release.resolve();await Promise.all([pendingA,pendingB]);}const page=await changes(before.cursor);assert.equal(page.changes.length,2);const events=await Promise.all([a,b].map(id=>c.db.collection('crmProjectEvents').doc(id).get()));assert.equal(Math.abs(events[0].data().feedSequence-events[1].data().feedSequence),1);
        },results);
        await h.caseRun('global pagination bounds and writes during pinned pages',async()=>{
            const before=await head();for(let i=0;i<65;i++)await run(op('page'),async()=>({result:{ok:true},affectedPaths:[`crmProjects/${projectId}/tasks/page-${i}`]}));
            let page=await changes(before.cursor);assert.equal(page.hasMore,true);await run(op('during'),async()=>({result:{ok:true},affectedPaths:[`crmProjects/${projectId}/tasks/during`]}));const seen=[];let cursor;
            do{assert.ok(page.costs.queryReads<=LIMITS.queryReads);assert.ok(page.taskIds.length+page.messageIds.length<=LIMITS.ids);assert.ok(Buffer.byteLength(JSON.stringify(page))<=LIMITS.responseBytes);seen.push(...page.taskIds);cursor=page.cursor;if(!page.hasMore)break;page=await changes(cursor);}while(true);
            assert.equal(new Set(seen).size,65);assert.ok(!seen.includes('during'));assert.deepEqual((await changes(cursor)).taskIds,['during']);
            const heads=Array(16).fill(Number.MAX_SAFE_INTEGER);const value=decodeCursor(cursor,identity.uid,projectId,heads);assert.equal(value.target,null);
        },results);
        await h.caseRun('direct hydration costs, inaccessible deletion, inactive message/list redaction parity and links revisions',async()=>{
            const messageId='old-message';h.expectStatus(await c.send('/tasks/t/discussion/messages',{operationId:op('message'),messageId,body:'Original'},'editor','POST'),200);
            h.expectStatus(await c.send(`/tasks/t/discussion/messages/${messageId}/moderate`,{operationId:op('moderate'),action:'hide',expectedRevision:1,reason:'Acceptance'},'owner','POST'),200);
            const links=createTaskLinksService({db:c.db,accessService,commandService:command,authorizeCrmIdentity:()=>true});const before=await head();const rev=(await c.data('t')).revision;await links.updateLinks(identity,projectId,'t',{operationId:op('links'),expectedRevision:rev,links:[]});const linkChange=await changes(before.cursor);assert.ok(linkChange.taskIds.includes('t'));
            const hydrated=await query.hydrateChanges(identity,projectId,{taskIds:['t','missing']});assert.equal(hydrated.tasks[0].revision,rev+1);assert.equal(hydrated.tasks[0].crmLinks,undefined);assert.deepEqual(hydrated.unavailableTaskIds,['missing']);assert.equal(hydrated.costs.taskEnumeration,0);assert.ok(hydrated.costs.recordReads<=LIMITS.hydrationReads);
            await h.task(c,'ancestor');const original=await c.data('t');const originalSection=(await c.projectRef.collection('sections').doc('s1').get()).data();
            try{
                for(const lifecycle of ['task','ancestor','section']){
                    await c.taskRef('t').set({...original,parentTaskId:lifecycle==='ancestor'?'ancestor':null,lifecycle:lifecycle==='task'?'archived':'active'});
                    await c.taskRef('ancestor').update({lifecycle:lifecycle==='ancestor'?'archived':'active'});
                    await c.projectRef.collection('sections').doc('s1').set({...originalSection,lifecycle:lifecycle==='section'?'archived':'active'});
                    for(const role of ['owner','editor','viewer']){
                        const batch=await query.hydrateChanges({uid:c.uids[role]},projectId,{taskIds:['t'],messageIds:[messageId]});const listed=h.expectStatus(await c.get('/tasks/t/discussion?order=desc',role),200);
                        assert.deepEqual(batch.messages[0],listed.messages.find(m=>m.id===messageId),`${lifecycle} ${role} parity`);assert.equal(batch.messages[0].redacted===true,role==='viewer');assert.deepEqual(batch.unavailableTaskIds,['t']);
                    }
                }
            }finally{await c.taskRef('t').set(original);await c.taskRef('ancestor').update({lifecycle:'active'});await c.projectRef.collection('sections').doc('s1').set(originalSection);}
        },results);
        await h.caseRun('whole 128KiB feed response overflow fails without a cursor and resumes the unacknowledged event after restoration',async()=>{
            const before=await head();await run(op('overflow-pending'));const savedProject=(await c.projectRef.get()).data();
            try{await c.projectRef.update({description:'x'.repeat(LIMITS.responseBytes)});const rejected=await c.get(`/changes?cursor=${encodeURIComponent(before.cursor)}`);assert.equal(rejected.status,413);assert.equal(rejected.body.cursor,undefined);assert.equal(rejected.body.error,'CHANGE_RESPONSE_LIMIT');}finally{await c.projectRef.set(savedProject);}
            const recovered=await changes(before.cursor);assert.equal(recovered.changes.length,1);assert.notEqual(recovered.cursor,before.cursor);assert.deepEqual(recovered.taskIds,['t']);
        },results);
        await h.caseRun('empty polls observe downgrade/revoke/suspend and malformed cursor errors are 400',async()=>{
            const before=await head();const actualReads=[];const originalRunTransaction=c.db.runTransaction;
            c.db.runTransaction=function(work,options){return originalRunTransaction.call(this,transaction=>work(new Proxy(transaction,{get(target,key){if(key==='get')return(reference,...args)=>{actualReads.push({path:reference.path||null,collectionId:reference._queryOptions?.collectionId||null});return target.get(reference,...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}})),options);};
            let empty;
            try{empty=await changes(before.cursor);await query.hydrateChanges(identity,projectId,{taskIds:['t'],messageIds:['old-message']});}finally{c.db.runTransaction=originalRunTransaction;}
            assert.equal(empty.changes.length,0);assert.equal(empty.costs.queryReads,0);assert.equal(empty.costs.taskEnumeration,0);
            assert.ok(actualReads.some(read=>read.path?.endsWith('/tasks/t')),'instrumentation sees actual task document read');assert.ok(!actualReads.some(read=>read.collectionId==='tasks'||read.path?.endsWith('/tasks')),'empty poll and ordinary hydration execute zero task collection queries');
            process.stdout.write(`REMOTE_ACTUAL_READS ${JSON.stringify(actualReads)}\n`);
            for(const raw of [null,3,{},'text'])assert.equal((await c.get(`/changes?cursor=${Buffer.from(JSON.stringify(raw)).toString('base64url')}`)).status,400);
            const member=c.db.collection('crmProjectMembers').doc(memberDocumentId(projectId,identity.uid));const saved=(await member.get()).data();try{await member.update({role:'Viewer'});assert.equal((await changes(empty.cursor)).authority.membership.role,'Viewer');await member.update({active:false});await assert.rejects(changes(empty.cursor));}finally{await member.set(saved);}
            const token=await c.token('owner');const profile=c.db.collection('users').doc(identity.uid);const savedProfile=(await profile.get()).data();
            try{await profile.update({accountStatus:'suspended'});assert.equal((await h.request(c.server,`/api/projects/${projectId}/changes?cursor=${encodeURIComponent(empty.cursor)}`,token)).status,403);}finally{await profile.set(savedProfile);}
        },results);
    }finally{c.server.closeAllConnections?.();await c.close();}
    h.finish(results);
}
main().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exitCode=1;});
