import { IDENTITY, validDocument, validActor, uuid } from '../../entrance-test-ui/annotation-model.js';
export const COLLECTION='entranceTestUiAnnotations/demo-d/items';
const failure=(code,message,latest)=>Object.assign(new Error(message),{code,latest});
const actorKey=a=>a?`${a.uid}|${a.raterId}|${a.name}`:'';
function equivalent(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function createAnnotationStore({adapter,identity}) {
 function prepare({id,body,region,previous=null,action='edit'}) {
  const actor=identity();if(!validActor(actor))throw failure('identity-changed','Sign in and confirm reviewer attribution.');if(!uuid(id))throw new Error('Invalid annotation ID');
  if(previous?.deleted&&action!=='restore')throw failure('conflict','This feedback was deleted. Restore it explicitly.',previous);
  const timestamp=adapter.timestamp();
  let data=previous?{...previous,lastEditor:{...actor},updatedAt:timestamp,version:previous.version+1,lastMutationId:crypto.randomUUID()}:{schemaVersion:1,...IDENTITY,anchorSchemaVersion:1,...region,body,author:{...actor},lastEditor:{...actor},createdAt:timestamp,updatedAt:timestamp,version:1,lastMutationId:crypto.randomUUID(),deleted:false,deletedAt:null,deletedBy:null};
  delete data.id;
  if(previous){if(body!==undefined)data.body=body;if(action==='reanchor'){if(!region)throw new Error('A new region is required');Object.assign(data,region);}if(action==='delete'){data.deleted=true;data.deletedAt=timestamp;data.deletedBy={...actor};}if(action==='restore'){data.deleted=false;data.deletedAt=null;data.deletedBy=null;}}
  if(!validDocument(data))throw failure('invalid','Feedback has invalid text, identity or region.');
  return {id,data,expectedVersion:previous?.version||0,actorKey:actorKey(actor)};
 }
 async function commit(op) {
  if(actorKey(identity())!==op.actorKey)throw failure('identity-changed','Reviewer changed. Reconfirm attribution before retrying.');
  const ref=adapter.ref(op.id);
  const data=await adapter.transaction(async tx=>{
   const snap=await tx.get(ref),current=snap.exists?snap.data():null;
   if(actorKey(identity())!==op.actorKey)throw failure('identity-changed','Reviewer changed during save.');
   if(current?.lastMutationId===op.data.lastMutationId){const content=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!['createdAt','updatedAt','deletedAt'].includes(k)));if(!equivalent(content(current),content(op.data)))throw failure('conflict','Mutation ID already has different content.',current);return current;}
   if((current?.version||0)!==op.expectedVersion)throw failure('conflict','Remote changes are available. Review latest before saving.',current);
   tx.set(ref,op.data);return op.data;
  });
  // Transactions resolve only after the backend acknowledges the commit.
  return adapter.read ? await adapter.read(op.id) : data;
 }
 return {prepare,commit,read:id=>adapter.read(id),listen:(...args)=>adapter.listen(...args),page:(...args)=>adapter.page(...args)};
}
export function firebaseAdapter(firebase) {
 const db=firebase.firestore(),collection=db.collection(COLLECTION);
 function query(cursor){let q=collection.orderBy('createdAt','desc').orderBy(firebase.firestore.FieldPath.documentId(),'desc');if(cursor)q=q.startAfter(cursor);return q.limit(50);}
 const unpack=snap=>({items:snap.docs.map(d=>({id:d.id,...d.data()})),cursor:snap.docs.at(-1)||null,more:snap.size===50});
 return {ref:id=>collection.doc(id),timestamp:()=>firebase.firestore.FieldValue.serverTimestamp(),transaction:fn=>db.runTransaction(fn),read:async id=>{const snap=await collection.doc(id).get({source:'server'});return snap.exists?{id:snap.id,...snap.data()}:null;},page:async cursor=>unpack(await query(cursor).get({source:'server'})),listen:(cursor,receive,error)=>query(cursor).onSnapshot({includeMetadataChanges:true},snap=>{if(!snap.metadata.fromCache)receive(unpack(snap));},error)};
}
