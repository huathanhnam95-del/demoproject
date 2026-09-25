const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const host=process.env.FIRESTORE_EMULATOR_HOST,projectId=process.env.GCLOUD_PROJECT;
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host||'')||!/^demo-/.test(projectId||''))throw new Error('Require explicit loopback FIRESTORE_EMULATOR_HOST and demo- GCLOUD_PROJECT before any DB operation');
const {initializeTestEnvironment,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc,collection,getDocs,query,orderBy,documentId,limit,serverTimestamp,Timestamp}=require('firebase/firestore');
let env,admin,other;
const rulesBytes=fs.readFileSync('firestore.rules');
const rulesHash=require('node:crypto').createHash('sha256').update(rulesBytes).digest('hex');
console.log('Frozen rules SHA256:',rulesHash);
async function assertFails(promise){await assert.rejects(promise,error=>{assert.doesNotMatch(error.message,/maximum of 1000|expression.*limit|expression.*budget/i,'Negative cases must fail by policy, never by exhausted evaluation budget');return error.code==='permission-denied';});}
test.before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:host.split(':')[0],port:Number(host.split(':')[1]),rules:rulesBytes.toString('utf8')}});await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'users/admin'),{isAdmin:true}));admin=env.authenticatedContext('admin').firestore();other=env.authenticatedContext('other').firestore();});
test.after(async()=>{await env?.cleanup();});
const base='entranceTestUiAnnotations/demo-d/items';
function data(){const a={uid:'admin',raterId:'reviewer',name:'Reviewer'};return {schemaVersion:1,skin:'d',contentVersion:'entrance_test_36plus_v1',visualRevision:'signal-noto-v2',anchorSchemaVersion:1,context:{page:'intro',view:'intro',questionId:null,componentState:''},anchor:{kind:'content',fragments:{f0:{kind:'element',targetId:'intro/title',rect:{x0:0,y0:0,x1:1,y1:1},text:null}},layoutSignature:'en|100',label:'Title'},capture:{frameWidth:1000,frameHeight:760,scrollX:0,scrollY:0,visualOffsetX:0,visualOffsetY:0,visualScale:1,locale:'en',textScale:100,fontEn:'',fontVi:'',buildId:'test'},body:'Tiếng Việt',author:{...a},lastEditor:{...a},createdAt:serverTimestamp(),updatedAt:serverTimestamp(),version:1,lastMutationId:crypto.randomUUID(),deleted:false,deletedAt:null,deletedBy:null};}
test('admin create, bounded ordered query, versioned edit/delete/restore; deny hard delete and stale version',async()=>{
 const ref=doc(admin,base,crypto.randomUUID());await assertSucceeds(setDoc(ref,data())); console.log("create acknowledged");await assertSucceeds(getDocs(query(collection(admin,base),orderBy('createdAt','desc'),orderBy(documentId(),'desc'),limit(50))));
 await assertSucceeds(updateDoc(ref,{body:'Edited',version:2,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));console.log('edit acknowledged');await assertFails(updateDoc(ref,{body:'Stale',version:2,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{deleted:true,deletedAt:serverTimestamp(),deletedBy:data().author,version:3,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
 console.log('delete acknowledged');await assertSucceeds(updateDoc(ref,{deleted:false,deletedAt:null,deletedBy:null,version:4,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));await assertFails(deleteDoc(ref));
 await assertFails(updateDoc(ref,{createdAt:Timestamp.fromMillis(0),version:5,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
});
test('nonadmin and signed-out read/write/list denied',async()=>{for(const db of [other,env.unauthenticatedContext().firestore()]){await assertFails(setDoc(doc(db,base,crypto.randomUUID()),data()));await assertFails(getDocs(collection(db,base)));await assertFails(getDoc(doc(db,base,crypto.randomUUID())));}});
test('strict nested payloads, forged metadata and nonfinite coordinates denied',async()=>{
 const mutations=[d=>{d.extra=1;},d=>{d.skin='a';},d=>{d.body='  \n\t';},d=>{d.body='x'.repeat(2001);},d=>{d.author.uid='other';},d=>{d.lastEditor.uid='other';},d=>{d.createdAt=Timestamp.fromMillis(0);},d=>{d.context.questionId='vocab_q99';},d=>{d.anchor.fragments.f0.rect.x0=NaN;},d=>{d.anchor.fragments.f0.rect.y1=Infinity;},d=>{d.anchor.fragments.f0.rect.x1=0;},d=>{d.anchor.fragments.f8=d.anchor.fragments.f0;},d=>{d.anchor.fragments.f0.rect.extra=1;},d=>{d.capture.visualScale=Infinity;},d=>{d.anchor.fragments.f0.text={html:'bad'};},d=>{d.deleted=true;},d=>{d.schemaVersion=2;}];
 for(const mutate of mutations){const d=data();mutate(d);await assertFails(setDoc(doc(admin,base,crypto.randomUUID()),d));}
});

for(let count=1;count<=3;count++) test(`${count} text fragments: create, another admin edit, delete, edit while deleted, restore`,async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users/editor'),{isAdmin:true}));
 const d=data();d.context={page:'listening',view:'question',questionId:'listen_write_q2',componentState:''};d.anchor.fragments={};
 for(let i=0;i<count;i++)d.anchor.fragments['f'+i]={kind:'text',targetId:'question/listen_write_q2/text/run'+i,rect:{x0:0,y0:0,x1:1,y1:1},text:{runId:'question/listen_write_q2/text/run'+i,start:0,end:3,fingerprint:'abc',quote:'abc'}};
 const id=crypto.randomUUID();await assertSucceeds(setDoc(doc(admin,base,id),d));
 const ref=doc(env.authenticatedContext('editor').firestore(),base,id),editor={uid:'editor',raterId:'editor',name:'Editor'};
 await assertSucceeds(updateDoc(ref,{lastEditor:editor,body:'Shared edit',version:2,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{context:{page:'vocab',view:'question',questionId:'vocab_q4',componentState:''},version:3,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{lastEditor:editor,deleted:true,deletedAt:serverTimestamp(),deletedBy:editor,version:4,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{body:'Deleted text audit correction',version:5,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{deleted:false,deletedAt:null,deletedBy:null,version:6,lastMutationId:crypto.randomUUID(),updatedAt:serverTimestamp()}));
});
test('fixed maps reject every missing, extra, and missing-plus-extra field without budget failures',async()=>{
 const paths=[[],['context'],['anchor'],['anchor','fragments','f0'],['anchor','fragments','f0','rect'],['capture'],['author'],['lastEditor']];
 for(const path of paths){const original=path.reduce((v,k)=>v[k],data());for(const key of Object.keys(original)){for(const replace of [false,true]){const d=data(),map=path.reduce((v,k)=>v[k],d);delete map[key];if(replace)map.unexpected='replacement';await assertFails(setDoc(doc(admin,base,crypto.randomUUID()),d));}}const d=data();path.reduce((v,k)=>v[k],d).unexpected=true;await assertFails(setDoc(doc(admin,base,crypto.randomUUID()),d));}
});

test('reject fourth fragments and invalid final supported fragment without budget exhaustion',async()=>{
 for(const invalid of ['fourth','geometry','text','extra','missing-plus-extra']){
  const d=data();d.anchor.fragments.f1=structuredClone(d.anchor.fragments.f0);d.anchor.fragments.f2=structuredClone(d.anchor.fragments.f0);
  if(invalid==='fourth')d.anchor.fragments.f3=structuredClone(d.anchor.fragments.f0);
  if(invalid==='geometry')d.anchor.fragments.f2.rect.x1=NaN;
  if(invalid==='text')d.anchor.fragments.f2.text={quote:'bad'};
  if(invalid==='extra')d.anchor.fragments.f2.extra=true;
  if(invalid==='missing-plus-extra'){delete d.anchor.fragments.f2.targetId;d.anchor.fragments.f2.extra=true;}
  await assertFails(setDoc(doc(admin,base,crypto.randomUUID()),d));
 }
});
test('real Firestore transactions preserve mutation idempotency and expose edit conflicts',async()=>{
 const {createAnnotationStore}=await import('../../public/js/crm/entrance-test-ui/annotations-store.js');const {runTransaction}=require('firebase/firestore');
 const adapter={ref:id=>doc(admin,base,id),timestamp:serverTimestamp,transaction:fn=>runTransaction(admin,tx=>fn({get:async ref=>{const s=await tx.get(ref);return {exists:s.exists(),data:()=>s.data()};},set:(ref,d)=>tx.set(ref,d)})),read:async id=>(await getDoc(doc(admin,base,id))).data()};
 const actor={uid:'admin',raterId:'reviewer',name:'Reviewer'},store=createAnnotationStore({adapter,identity:()=>actor});const d=data();const op=store.prepare({id:crypto.randomUUID(),body:'Transaction',region:{context:d.context,anchor:d.anchor,capture:d.capture}});
 const initial=await store.commit(op);assert.equal(initial.version,1);await store.commit(op);const left=store.prepare({id:op.id,previous:initial,body:'Left'}),right=store.prepare({id:op.id,previous:initial,body:'Right'});await store.commit(left);await assert.rejects(store.commit(right),e=>e.code==='conflict'&&e.latest.body==='Left');
});
test('text-map missing/extra keys and nonnumeric coordinates are rejected by validation',async()=>{
 const textAnchor=()=>{const d=data();d.anchor.fragments.f0.kind='text';d.anchor.fragments.f0.text={runId:'intro/title',start:0,end:1,fingerprint:'a',quote:'a'};return d;};
 for(const key of Object.keys(textAnchor().anchor.fragments.f0.text)){const d=textAnchor();delete d.anchor.fragments.f0.text[key];d.anchor.fragments.f0.text.unexpected=true;await assertFails(setDoc(doc(admin,base,crypto.randomUUID()),d));}
 for(const value of ['0',false,{},[]]){const d=data();d.anchor.fragments.f0.rect.x0=value;await assertFails(setDoc(doc(admin,base,crypto.randomUUID()),d));}
});
