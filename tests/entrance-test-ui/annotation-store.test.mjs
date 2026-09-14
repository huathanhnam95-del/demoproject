import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationStore } from '../../public/js/crm/entrance-test-ui/annotations-store.js';
function setup(){const docs=new Map();let user={uid:'admin',raterId:'reviewer',name:'Reviewer'};const adapter={ref:id=>id,transaction:async fn=>fn({get:async id=>({exists:docs.has(id),data:()=>docs.get(id)}),set:(id,d)=>docs.set(id,d)}),timestamp:()=>123};return {docs,changeUser:()=>{user={...user,uid:'other'};},store:createAnnotationStore({adapter,identity:()=>user})};}
const region={context:{page:'intro',view:'intro',questionId:null,componentState:''},anchor:{kind:'content',fragments:{f0:{kind:'element',targetId:'intro/title',rect:{x0:0,y0:0,x1:1,y1:1},text:null}},layoutSignature:'en|100',label:'Title'},capture:{frameWidth:1000,frameHeight:760,scrollX:0,scrollY:0,visualOffsetX:0,visualOffsetY:0,visualScale:1,locale:'en',textScale:100,fontEn:'',fontVi:'',buildId:'test'}};
test('create retry uses one ID; version conflict never overwrites; soft delete and restore',async()=>{
 const {store,docs}=setup(), id=crypto.randomUUID(),op=store.prepare({id,body:'Tiếng Việt',region});
 const first=await store.commit(op);await store.commit(op);assert.equal(docs.size,1);assert.equal(first.version,1);
 const edit=store.prepare({id,body:'Edited',previous:first});const updated=await store.commit(edit);assert.equal(updated.version,2);
 await assert.rejects(store.commit(store.prepare({id,body:'Stale',previous:first})),e=>e.code==='conflict'&&e.latest.body==='Edited');
 const deleted=await store.commit(store.prepare({id,previous:updated,action:'delete'}));assert.equal(deleted.deleted,true);
 await assert.rejects(store.commit(store.prepare({id,body:'Resurrect',previous:updated})),e=>e.code==='conflict');
 const restored=await store.commit(store.prepare({id,previous:deleted,action:'restore'}));assert.equal(restored.deleted,false);assert.equal(restored.createdAt,first.createdAt);
});
test('identity capture and offline failure retain immutable operation',async()=>{
 const {store,changeUser,docs}=setup();const op=store.prepare({id:crypto.randomUUID(),body:'Unsaved',region});changeUser();await assert.rejects(store.commit(op),e=>e.code==='identity-changed');assert.equal(docs.size,0);assert.equal(op.data.body,'Unsaved');
});
test('ambiguous create acknowledgment retries the same ID without a duplicate',async()=>{
 const docs=new Map(),actor={uid:'admin',raterId:'reviewer',name:'Reviewer'};let first=true;
 const adapter={ref:id=>id,timestamp:()=>123,transaction:async fn=>fn({get:async id=>({exists:docs.has(id),data:()=>docs.get(id)}),set:(id,d)=>docs.set(id,d)}),read:async id=>{if(first){first=false;throw new Error('Response lost after commit');}return docs.get(id);}};
 const store=createAnnotationStore({adapter,identity:()=>actor}),op=store.prepare({id:crypto.randomUUID(),body:'Retry me',region});await assert.rejects(store.commit(op),/Response lost/);assert.equal(docs.size,1);await store.commit(op);assert.equal(docs.size,1);
});
