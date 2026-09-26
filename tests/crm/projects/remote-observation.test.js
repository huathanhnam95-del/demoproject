'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectsChangeFeedService, prepareFeedCommit, shardFor, encodeCursor, decodeCursor, hints, LIMITS, readFeedHeads, handshakeFromSnapshot } = require('../../../functions/src/crm/projects/change-feed-service');
const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
const { createProjectsQueryService } = require('../../../functions/src/crm/projects/domain/query-service');
require('../../../public/js/crm/projects/remote-observer');
const { createController } = globalThis.CrmProjectsRemoteObserver;
function fixture() {
    const records = new Map(); const reads = []; let eligible = true; let role = 'Owner';
    function ref(path, predicates = [], cap = Infinity, ordering = '') { return { path, id: path.split('/').pop(), predicates, cap, ordering, doc: id => ref(`${path}/${id}`), collection: id => ref(`${path}/${id}`), where: (field, op, value) => ref(path, [...predicates, [field, op, value]], cap, ordering), orderBy: field => ref(path, predicates, cap, field), limit: n => ref(path, predicates, n, ordering) }; }
    function snapshot(target) {
        if (target.path.split('/').length % 2 === 0) return { exists: records.has(target.path), id: target.id, ref: target, data: () => structuredClone(records.get(target.path)) };
        const docs = [...records.keys()].filter(key => key.startsWith(`${target.path}/`) && key.split('/').length === target.path.split('/').length + 1).map(key => snapshot(ref(key))).filter(doc => target.predicates.every(([field, op, n]) => op === '==' ? doc.data()[field] === n : op === '>' ? doc.data()[field] > n : doc.data()[field] <= n));
        if (target.ordering) docs.sort((a,b) => a.data()[target.ordering] - b.data()[target.ordering]);
        return { docs: docs.slice(0, target.cap), size: Math.min(docs.length, target.cap) };
    }
    const db = { collection: ref, async runTransaction(work) { let writing = false; const writes = []; const result = await work({ async get(target) { assert.equal(writing, false, `late read: ${target.path}`); reads.push(target.path); return snapshot(target); }, set(target, value) { writing = true; writes.push([target.path, structuredClone(value)]); } }); writes.forEach(([path,value]) => records.set(path,value)); return result; } };
    records.set('crmProjects/p', { lifecycle: 'active', revision: 1, membershipRevision: 1 });
    records.set('crmProjects/p/sections/s', { lifecycle: 'active' });
    records.set('crmProjects/p/tasks/t', { title: 'Task', projectId: 'p', revision: 1, sectionId: 's', lifecycle: 'active', parentTaskId: null, crmLinks: ['SECRET'] });
    const accessService = { async assertTransactionContentAccess(tx, actorUid, projectId) { if (!eligible) throw Object.assign(Error('denied'), { status: 403 }); const project = await tx.get(ref(`crmProjects/${projectId}`)); return { role, actorUid, project: { id: projectId, data: project.data() }, membership: { data: { role, revision: 1 } } }; } };
    const feed = createProjectsChangeFeedService({ db, accessService }); const command = createProjectsCommandService({ db, accessService }); const query = createProjectsQueryService({ db, accessService });
    async function event(operationId, metadata = {}) { await db.runTransaction(async tx => { const stamp = await prepareFeedCommit(tx, db, 'p', operationId); stamp.commit(); tx.set(ref(`crmProjectEvents/${operationId}`), { projectId:'p', ...stamp.stamp, affectedPaths:['crmProjects/p/tasks/t'], ...metadata }); }); }
    return { records, reads, db, ref, feed, command, query, event, identity: { uid:'a' }, eligible(value) { eligible = value; }, role(value) { role = value; } };
}
test('cursor rejects null, primitive, malformed, future, actor/project and reverse target vectors', () => {
    const good = { v:1, actorUid:'a', projectId:'p', ack:Array(16).fill(0), target:null }; const heads = Array(16).fill(5);
    assert.deepEqual(decodeCursor(encodeCursor(good),'a','p',heads),good);
    for (const value of [null,1,'x',[],{}, { ...good, actorUid:'b' }, { ...good, projectId:'q' }, { ...good, ack:Array(16).fill(6) }, { ...good, ack:Array(16).fill(2), target:Array(16).fill(1) }]) assert.throws(() => decodeCursor(encodeCursor(value),'a','p',heads),error => error.status === 400);
    assert.throws(() => decodeCursor('x'.repeat(4097),'a','p',heads),error => error.status === 400);
});
test('empty polls reread authority and 16 heads with zero task enumeration', async () => {
    const f=fixture(); const start=await f.feed.poll(f.identity,'p'); f.reads.length=0;
    const empty=await f.feed.poll(f.identity,'p',{cursor:start.cursor}); assert.equal(empty.changes.length,0); assert.equal(empty.costs.queryReads,0); assert.equal(f.reads.filter(path=>path.includes('/changeHeads/')).length,16); assert.ok(!f.reads.some(path=>path.endsWith('/tasks')));
    f.role('Viewer'); assert.equal((await f.feed.poll(f.identity,'p',{cursor:empty.cursor})).authority.membership.role,'Viewer');
    f.eligible(false); await assert.rejects(f.feed.poll(f.identity,'p',{cursor:empty.cursor}),{status:403});
});
test('global pages pin target, bound queries/IDs/bytes and catch writes during pagination afterward', async () => {
    const f=fixture(); let cursor=(await f.feed.poll(f.identity,'p')).cursor;
    for(let i=0;i<70;i++)await f.event(`op-${i}`,{affectedPaths:[`crmProjects/p/tasks/t${i}`]});
    let page=await f.feed.poll(f.identity,'p',{cursor}); assert.equal(page.hasMore,true); const fixed=decodeCursor(page.cursor,'a','p',Array(16).fill(100)).target;
    await f.event('new-during-pages',{affectedPaths:['crmProjects/p/tasks/new']}); const seen=[];
    do { assert.ok(page.taskIds.length<=32);assert.ok(page.costs.queryReads<=32);assert.ok(Buffer.byteLength(JSON.stringify(page))<=LIMITS.responseBytes);seen.push(...page.taskIds);cursor=page.cursor; if(!page.hasMore)break; assert.deepEqual(decodeCursor(cursor,'a','p',Array(16).fill(100)).target,fixed); page=await f.feed.poll(f.identity,'p',{cursor}); } while(true);
    assert.equal(new Set(seen).size,70);assert.ok(!seen.includes('new')); const next=await f.feed.poll(f.identity,'p',{cursor}); assert.deepEqual(next.taskIds,['new']);
});
test('command counter/event is atomic, replay and failure emit zero, all reads precede consumption writes', async () => {
    const f=fixture(); const run=(operationId,fail=false)=>f.command.runCommand({actorUid:'a',projectId:'p',command:'test',operationId,payload:{},prepareAuthorization:async()=>({replayed:f.records.has(`crmProjectOperations/${operationId}`),consume(){}}),execute:async({transaction})=>{ await transaction.get(f.ref('crmProjects/p/tasks/t'));if(fail)throw Error('failed');return {result:{ok:true},affectedPaths:['crmProjects/p/tasks/t']};}});
    const baseline=(await f.feed.poll(f.identity,'p')).cursor;
    await run('one');await run('one');await assert.rejects(run('fail',true));
    const changes=await f.feed.poll(f.identity,'p',{cursor:baseline});assert.equal(changes.changes.length,1);assert.equal(f.records.get(`crmProjects/p/changeHeads/${shardFor('one')}`).sequence,1);assert.equal(f.records.has('crmProjectEvents/fail'),false);
});
test('direct hydration strips CRM fields, removes unavailable tasks and matches inactive message redaction', async () => {
    const f=fixture();f.records.set('crmProjects/p/discussions/m',{projectId:'p',taskId:'t',body:'private',moderationState:'hidden',authorUid:'other',revision:2,mentions:['other'],attachmentIds:['file']});f.role('Viewer');
    const out=await f.query.hydrateChanges(f.identity,'p',{taskIds:['t','gone'],messageIds:['m']});assert.equal(out.tasks[0].crmLinks,undefined);assert.deepEqual(out.unavailableTaskIds,['gone']);assert.equal(out.messages[0].redacted,true);assert.equal(out.messages[0].body,null);
    f.records.get('crmProjects/p/tasks/t').lifecycle='archived';const archived=await f.query.hydrateChanges(f.identity,'p',{taskIds:['t'],messageIds:['m']});assert.deepEqual(archived.unavailableTaskIds,['t']);assert.equal(archived.messages.length,1);
    assert.ok(!f.reads.some(path=>path.endsWith('/tasks')));await assert.rejects(f.query.hydrateChanges(f.identity,'p',{taskIds:Array.from({length:33},(_,i)=>`t${i}`)}),{status:400});
    assert.deepEqual(hints({command:'updateTaskLinks',targetId:'t',projectId:'p',affectedIds:['p','t','SECRET']}).taskIds,['t']);
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
const flush=()=>new Promise(setImmediate);
test('observer serializes delayed snapshots before hydration/apply and acknowledges only completed repair',async()=>{
    const gate=deferred();const requests=[];const order=[];let applied=0;const authority={signature:'Owner',project:{id:'p'},membership:{role:'Owner'}};
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async(url,options)=>{requests.push(url);if(options)return{tasks:[],messages:[],unavailableTaskIds:[],unavailableMessageIds:[]};return{authority,cursor:url.includes('cursor=')?'after':'head',hasMore:false,changes:[],taskIds:[],messageIds:[]};},apply:async()=>{order.push('apply');return ++applied>1;}});
    try{const loading=observer.snapshot('p',async()=>{order.push('load-start');await gate.promise;order.push('load-end');});await flush();observer.tick();await flush();assert.deepEqual(order,['load-start']);gate.resolve();await loading;await flush();assert.deepEqual(order,['load-start','load-end','apply']);assert.equal(observer.getState().cursor,'head');observer.tick();await flush();assert.equal(observer.getState().cursor,'after');assert.ok(requests.filter(url=>url==='/api/projects/p/changes').length>=2,'pending repair rereads authority and heads');}finally{observer.dispose();}
});
test('observer drops late replies after account/project teardown',async()=>{
    const gate=deferred();let applied=0;let uid='a';const observer=createController({getCurrentUser:()=>({uid}),apiFetchJson:async()=>gate.promise,apply:async()=>applied++});
    try{const loading=observer.snapshot('p',()=>{throw Error('late load');});await flush();uid='b';observer.stop();gate.resolve({cursor:'head',authority:{signature:'x'}});assert.equal(await loading,false);assert.equal(applied,0);}finally{observer.dispose();}
});
test('deep ancestry stops at the shared hydration budget and observer retries exceptional repair before ack',async()=>{
    const f=fixture();for(let i=0;i<1025;i++)f.records.set(`crmProjects/p/tasks/deep-${i}`,{projectId:'p',sectionId:'s',parentTaskId:i?`deep-${i-1}`:null,lifecycle:'active'});
    await assert.rejects(f.query.hydrateChanges(f.identity,'p',{taskIds:['deep-1024']}),error=>error.status===413&&error.code==='HYDRATION_READ_LIMIT');
    assert.equal(f.reads.filter(path=>path.includes('/tasks/')).length,1024);
    let calls=0;let applies=0;const authority={signature:'Owner',project:{id:'p'},membership:{role:'Owner'}};
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async(url,options)=>{if(options){calls++;throw Object.assign(Error('deep'),{status:413});}return{authority,cursor:url.includes('cursor=')?'after':'head',hasMore:false,changes:[{}],taskIds:['deep'],messageIds:[]};},apply:async change=>{assert.equal(change.hydrationFallback,true);assert.equal(change.refresh,true);return ++applies>1;}});
    try{await observer.snapshot('p',async()=>true);observer.tick();await flush();assert.equal(observer.getState().cursor,'head');observer.tick();await flush();assert.equal(observer.getState().cursor,'after');assert.equal(calls,1,'retry retains exact hydrated page rather than repeatedly exhausting ancestry');}finally{observer.dispose();}
});
test('discussion repairs older loaded IDs in four-request turns and empty polls do not render',async()=>{
    const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let writes=0,hydrateCalls=0;
    const list={get innerHTML(){return '';},set innerHTML(value){writes++;},querySelectorAll:()=>[],insertAdjacentHTML(){},scrollTop:12};
    const rows=Array.from({length:150},(_,i)=>({id:`m${i}`,taskId:'t',body:'before',revision:1,authorUid:'a',createdAt:String(i).padStart(4,'0'),moderationState:'visible'}));
    const context={URLSearchParams,document:{getElementById:()=>null}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../public/js/crm/projects/discussion.js'),'utf8'),context);
    const controller=context.CrmProjectsDiscussion.createController({elements:{projectsBoardDiscussionList:list},getCurrentUser:()=>({uid:'a'}),apiFetchJson:async(url,options)=>{if(options){hydrateCalls++;const ids=JSON.parse(options.body).messageIds;assert.ok(ids.length<=32);return{messages:rows.filter(row=>ids.includes(row.id)).map(row=>({...row,body:'fresh',revision:2})),unavailableMessageIds:[]};}return url.includes('member-directory')?{people:[]}:{messages:rows,hasMore:false};}});
    controller.setSelection({projectId:'p',taskId:'t',role:'Owner'});await flush();const baseline=writes;
    const change={cursor:'repair',messageIds:[],authorityChanged:false,discussionRefresh:false,isCurrent:()=>true,hydration:{messages:[],unavailableMessageIds:[]}};
    assert.equal(await controller.applyRemote(change),true);assert.equal(writes,baseline);
    change.authorityChanged=true;assert.equal(await controller.applyRemote(change),false);assert.equal(hydrateCalls,4);assert.equal(await controller.applyRemote(change),true);assert.equal(hydrateCalls,5);assert.equal(controller.getState().messages.length,150);assert.ok(controller.getState().messages.every(row=>row.body==='fresh'));assert.equal(list.scrollTop,12);
});
test('pending Owner repair discards cached privileged hydration on Viewer downgrade beyond the first 128 IDs',async()=>{
    const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let role='Owner',html='',downgradeObservation=null;
    const rows=Array.from({length:150},(_,i)=>({id:`m${i}`,taskId:'t',body:`PRIVATE-${i}`,revision:2,authorUid:'other',createdAt:String(i).padStart(4,'0'),moderationState:'hidden'}));
    const redact=message=>role==='Owner'?{...message}:{...message,body:null,mentions:[],attachmentIds:[],redacted:true};
    const list={get innerHTML(){return html;},set innerHTML(value){html=value;},querySelectorAll:()=>[],insertAdjacentHTML(){},scrollTop:0};
    const context={URLSearchParams,document:{getElementById:()=>null}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../public/js/crm/projects/discussion.js'),'utf8'),context);
    const authority=()=>({signature:role,project:{id:'p'},membership:{role}});
    const api=async(url,options)=>{if(options){const ids=JSON.parse(options.body).messageIds||[];return{tasks:[],messages:rows.filter(row=>ids.includes(row.id)).map(redact),unavailableTaskIds:[],unavailableMessageIds:[]};}if(url.includes('member-directory'))return{people:[]};if(url.includes('/discussion?'))return{messages:rows.map(redact),hasMore:false};return{authority:authority(),cursor:url.includes('cursor=')?'after':'head',taskIds:[],messageIds:['m0'],changes:[{}],discussionRefresh:true,hasMore:false};};
    const controller=context.CrmProjectsDiscussion.createController({elements:{projectsBoardDiscussionList:list},getCurrentUser:()=>({uid:'a'}),apiFetchJson:api});controller.setSelection({projectId:'p',taskId:'t',role});await flush();
    let applyCount=0;
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:api,apply:async change=>{
        applyCount++;controller.setSelection({projectId:'p',taskId:'t',role});
        const completed=await controller.applyRemote(change);
        if(role==='Viewer'&&!downgradeObservation)downgradeObservation={completed,hydrationSafe:change.hydration.messages.every(message=>message.body===null),allRedacted:controller.getState().messages.every(message=>message.body===null),html};
        return completed;
    }});
    controller.attachRemoteObserver(observer);
    try{
        await observer.snapshot('p',async()=>true);observer.tick();await flush();await flush();assert.equal(observer.getState().cursor,'head');assert.equal(applyCount,1);
        role='Viewer';observer.tick();await flush();await flush();assert.ok(downgradeObservation);assert.equal(downgradeObservation.completed,false);assert.equal(downgradeObservation.hydrationSafe,true);assert.equal(downgradeObservation.allRedacted,true);assert.ok(!downgradeObservation.html.includes('PRIVATE-0'),'last repair ID never re-exposes cached Owner body');
        observer.tick();await flush();await flush();assert.equal(observer.getState().cursor,'after');assert.equal(controller.getState().messages.length,150);assert.ok(controller.getState().messages.every(message=>message.body===null));
    }finally{observer.dispose();}
});
test('whole feed serialized response overflow never supplies an advancing cursor and recovers from the prior cursor',async()=>{
    const f=fixture();const before=await f.feed.poll(f.identity,'p');await f.event('after-head');f.records.get('crmProjects/p').description='x'.repeat(LIMITS.responseBytes);
    await assert.rejects(f.feed.poll(f.identity,'p',{cursor:before.cursor}),error=>error.status===413&&error.code==='CHANGE_RESPONSE_LIMIT');delete f.records.get('crmProjects/p').description;
    const recovered=await f.feed.poll(f.identity,'p',{cursor:before.cursor});assert.equal(recovered.changes.length,1);assert.notEqual(recovered.cursor,before.cursor);
});
test('pending page signature change refetches task IDs before acknowledging, even without a board refresh',async()=>{
    let signature='one',hydrateCalls=0,applies=0;const applied=[];
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async(url,options)=>{
        if(options){hydrateCalls++;return{tasks:[{id:'t',revision:hydrateCalls,title:signature}],messages:[],unavailableTaskIds:[],unavailableMessageIds:[]};}
        return{authority:{signature,project:{id:'p'},membership:{role:'Owner'}},cursor:url.includes('cursor=')?'after':'head',taskIds:['t'],messageIds:[],changes:[{}],hasMore:false};
    },apply:async change=>{applied.push(change.hydration.tasks);return ++applies>1;}});
    try{await observer.snapshot('p',async()=>true);observer.tick();await flush();assert.equal(observer.getState().cursor,'head');signature='two';observer.tick();await flush();assert.equal(hydrateCalls,2);assert.equal(applied[1][0].title,'two');assert.equal(observer.getState().cursor,'after');}finally{observer.dispose();}
});
test('feed response overflow leaves the observer acknowledgement unchanged until a successful retry',async()=>{
    let oversized=false,applies=0;
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async url=>{if(oversized)throw Object.assign(Error('response byte limit'),{status:413});return{authority:{signature:'Owner',project:{id:'p'}},cursor:url.includes('cursor=')?'after':'head',taskIds:[],messageIds:[],changes:[],hasMore:false};},apply:async()=>{applies++;return true;}});
    try{await observer.snapshot('p',async()=>true);oversized=true;observer.tick();await flush();assert.equal(observer.getState().cursor,'head');assert.equal(applies,0);oversized=false;observer.tick();await flush();assert.equal(observer.getState().cursor,'after');assert.equal(applies,1);}finally{observer.dispose();}
});
test('snapshot access denial settles false, clears the cursor and invalidates once even for unawaited loads',async()=>{
    for(const status of [401,403,404]){
        let rejected=false,loaded=0;const denials=[];
        const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async()=>{if(rejected)throw Object.assign(Error('Project not found.'),{status});return{cursor:'head',authority:{signature:'Owner'}};},onDenied:id=>denials.push(id)});
        try{
            await observer.snapshot('p',async()=>true);assert.equal(observer.getState().cursor,'head');rejected=true;
            const first=observer.snapshot('p',async()=>{loaded++;});const second=observer.snapshot('p',async()=>{loaded++;});
            // Let fire-and-forget callers return before consuming the result.
            await flush();assert.equal(await first,false);assert.equal(await second,false);assert.equal(loaded,0);assert.deepEqual(denials,['p']);assert.equal(observer.getState().cursor,'');assert.equal(observer.getState().projectId,'');
        }finally{observer.dispose();}
    }
});
test('stale snapshot denial cannot invalidate a newly selected project and unexpected current errors still reject',async()=>{
    const gate=deferred(),denials=[];let request=0;
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async()=>{if(++request===1){await gate.promise;throw Object.assign(Error('old forbidden'),{status:403});}return{cursor:'head-q',authority:{signature:'Owner'}};},onDenied:id=>denials.push(id)});
    try{const old=observer.snapshot('p',async()=>true);await flush();const next=observer.snapshot('q',async()=>true);gate.resolve();assert.equal(await old,false);assert.equal(await next,true);assert.deepEqual(denials,[]);assert.equal(observer.getState().projectId,'q');}finally{observer.dispose();}
    const failure=Error('unexpected programming failure');const errors=[];const unexpected=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async()=>{throw failure;},onError:error=>errors.push(error)});
    try{await assert.rejects(unexpected.snapshot('p',async()=>true),error=>error===failure);assert.deepEqual(errors,[failure]);}finally{unexpected.dispose();}
});
test('transient first handshake retains its scoped load and runs it before later change application',async()=>{
    let requests=0,loads=0;const order=[],errors=[];
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async url=>{order.push('request');if(++requests===1)throw Object.assign(Error('temporarily unavailable'),{status:503});return{authority:{signature:'Owner'},cursor:url.includes('cursor=')?'after':'head',taskIds:[],messageIds:[],changes:[],hasMore:false};},onError:error=>errors.push(error),apply:async()=>{order.push('apply');assert.equal(loads,1);return true;}});
    try{assert.equal(await observer.snapshot('p',async()=>{loads++;order.push('load');return true;}),false);assert.equal(observer.getState().cursor,'');assert.equal(loads,0);assert.equal(errors.length,1);observer.tick();await flush();assert.equal(loads,1);assert.equal(observer.getState().cursor,'after');assert.ok(order.indexOf('load')<order.indexOf('apply'));observer.tick();await flush();assert.equal(loads,1);}finally{observer.dispose();}
});
test('account or project switch cancels a retained handshake retry; terminal retry denial invalidates once',async()=>{
    for(const change of ['project','account','denial']){
        let uid='a',requests=0,oldLoads=0,newLoads=0;const denials=[];
        const observer=createController({getCurrentUser:()=>({uid}),apiFetchJson:async()=>{if(++requests===1)throw Object.assign(Error('temporary'),{status:503});if(change==='denial')throw Object.assign(Error('revoked'),{status:403});return{authority:{signature:'Owner'},cursor:'head',taskIds:[],messageIds:[],changes:[],hasMore:false};},onDenied:id=>denials.push(id),apply:async()=>true});
        try{assert.equal(await observer.snapshot('p',async()=>{oldLoads++;return true;}),false);if(change==='project')await observer.snapshot('q',async()=>{newLoads++;return true;});if(change==='account')uid='b';observer.tick();await flush();assert.equal(oldLoads,0);if(change==='project'){assert.equal(newLoads,1);assert.equal(observer.getState().projectId,'q');assert.deepEqual(denials,[]);}else{assert.equal(observer.getState().cursor,'');assert.equal(observer.getState().projectId,'');assert.deepEqual(denials,['p']);observer.tick();await flush();assert.deepEqual(denials,['p']);}}finally{observer.dispose();}
    }
});

test('an /open snapshot reads heads in its own transaction; polling from its cursor misses nothing',async()=>{
    const f=fixture();await f.event('before');
    let transactions=0;const run=f.db.runTransaction.bind(f.db);f.db.runTransaction=work=>{transactions++;return run(work);};
    const snapshot=await f.query.readSnapshot(f.identity,'p',{readFeedHeads:(tx,id)=>readFeedHeads(tx,f.db,id)});
    assert.equal(transactions,1,'heads and board records come from one transaction');
    assert.equal(snapshot.feedHeads.length,16);
    const opened=handshakeFromSnapshot(f.identity,'p',snapshot.access,snapshot.feedHeads);
    const handshake=await f.feed.poll(f.identity,'p');
    assert.deepEqual(decodeCursor(opened.cursor,'a','p',Array(16).fill(100)),decodeCursor(handshake.cursor,'a','p',Array(16).fill(100)));
    assert.equal(opened.authority.signature,handshake.authority.signature);
    assert.equal((await f.feed.poll(f.identity,'p',{cursor:opened.cursor})).changes.length,0,'the snapshot already includes earlier changes');
    await f.event('after');
    assert.equal((await f.feed.poll(f.identity,'p',{cursor:opened.cursor})).changes.length,1,'a later change is seen from the snapshot cursor');
    assert.throws(()=>handshakeFromSnapshot(f.identity,'p',snapshot.access,undefined),{status:500});
});
test('inline observer snapshots seed the cursor without a handshake, or hand the handshake to the load',async()=>{
    const requests=[];const authority={signature:'Owner',project:{id:'p'},membership:{role:'Owner'}};
    const observer=createController({getCurrentUser:()=>({uid:'a'}),apiFetchJson:async url=>{requests.push(url);return{authority,cursor:'head',hasMore:false,changes:[],taskIds:[],messageIds:[]};},apply:async()=>true});
    try{
        assert.equal(await observer.snapshot('p',feed=>feed.seed({cursor:'opened',authority}),{inline:true}),true);
        assert.equal(requests.length,0,'no separate handshake request');assert.equal(observer.getState().cursor,'opened');
        observer.stop();const order=[];
        await observer.snapshot('q',async feed=>{assert.equal(await feed.handshake(),true);order.push('reads');return true;},{inline:true});
        assert.deepEqual(requests,['/api/projects/q/changes']);assert.deepEqual(order,['reads']);assert.equal(observer.getState().cursor,'head');
        observer.stop();
        assert.equal(await observer.snapshot('r',feed=>feed.seed({cursor:'x'}),{inline:true}),false,'a seed without authority is rejected');
        assert.equal(observer.getState().cursor,'');
    }finally{observer.dispose();}
});
