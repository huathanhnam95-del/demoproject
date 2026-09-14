import { NORMALIZED_DEMO_DATA } from './demo-data.js';
export const PROTOCOL = 'etui:annotations:v1';
export const IDENTITY = Object.freeze({skin:'d',contentVersion:'entrance_test_36plus_v1',visualRevision:'signal-noto-v2'});
export const QUESTIONS = new Map(NORMALIZED_DEMO_DATA.sections.flatMap(s=>s.questions.map(q=>[q.questionId,s.id==='listen_write'?'listening':s.id])));
export const uuid = value => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
export const keys = (v, names) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length===names.length && names.every(k=>Object.hasOwn(v,k));
const str = (v,max,min=0) => typeof v === 'string' && v.length>=min && v.length<=max;
const num = (v,min,max) => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
export function contextFor(view, questionId=null, componentState='') { return {page:view==='question'?QUESTIONS.get(questionId):view,view,questionId:view==='question'?questionId:null,componentState}; }
export function validContext(c) {
 return keys(c,['page','view','questionId','componentState']) && str(c.componentState,160) && (c.view==='question' ? QUESTIONS.has(c.questionId)&&QUESTIONS.get(c.questionId)===c.page : ['intro','miccheck','review','done'].includes(c.view)&&c.page===c.view&&c.questionId===null);
}
export const sameContext=(a,b)=>validContext(a)&&validContext(b)&&['page','view','questionId','componentState'].every(k=>a[k]===b[k]);
export function validFragment(f) {
 return keys(f,['kind','targetId','rect','text']) && ['element','text','layout'].includes(f.kind) && str(f.targetId,200,1) && /^[a-zA-Z0-9_/-]+$/.test(f.targetId) && keys(f.rect,['x0','y0','x1','y1']) && Object.values(f.rect).every(v=>num(v,0,1)) && f.rect.x1>f.rect.x0 && f.rect.y1>f.rect.y0 && (f.kind==='text' ? keys(f.text,['runId','start','end','fingerprint','quote'])&&str(f.text.runId,200,1)&&Number.isInteger(f.text.start)&&Number.isInteger(f.text.end)&&f.text.start>=0&&f.text.end>f.text.start&&f.text.end<=20000&&str(f.text.fingerprint,32,1)&&str(f.text.quote,160) : f.text===null);
}
export function validRegion(a) {
 return keys(a,['kind','fragments','layoutSignature','label'])&&['content','layout'].includes(a.kind)&&str(a.layoutSignature,240,1)&&str(a.label,160,1)&&a.fragments&&typeof a.fragments==='object'&&!Array.isArray(a.fragments)&&Object.keys(a.fragments).length>=1&&Object.keys(a.fragments).length<=3&&Object.entries(a.fragments).every(([k,v])=>/^f[0-2]$/.test(k)&&validFragment(v));
}
export function validCapture(c) {
 return keys(c,['frameWidth','frameHeight','scrollX','scrollY','visualOffsetX','visualOffsetY','visualScale','locale','textScale','fontEn','fontVi','buildId'])&&['frameWidth','frameHeight'].every(k=>num(c[k],1,20000))&&['scrollX','scrollY','visualOffsetX','visualOffsetY'].every(k=>num(c[k],-100000,100000))&&num(c.visualScale,.1,10)&&['en','vi'].includes(c.locale)&&num(c.textScale,50,300)&&str(c.fontEn,100)&&str(c.fontVi,100)&&str(c.buildId,100,1);
}
export const validActor=a=>keys(a,['uid','raterId','name'])&&str(a.uid,128,1)&&str(a.raterId,60,1)&&str(a.name,80,2);
export function validDocument(d) {
 return keys(d,['schemaVersion','skin','contentVersion','visualRevision','anchorSchemaVersion','context','anchor','capture','body','author','lastEditor','createdAt','updatedAt','version','lastMutationId','deleted','deletedAt','deletedBy'])&&d.schemaVersion===1&&d.anchorSchemaVersion===1&&Object.entries(IDENTITY).every(([k,v])=>d[k]===v)&&validContext(d.context)&&validRegion(d.anchor)&&validCapture(d.capture)&&str(d.body,2000,1)&&!!d.body.trim()&&validActor(d.author)&&validActor(d.lastEditor)&&Number.isInteger(d.version)&&d.version>=1&&uuid(d.lastMutationId)&&typeof d.deleted==='boolean'&&(d.deleted?d.deletedAt!=null&&validActor(d.deletedBy):d.deletedAt===null&&d.deletedBy===null);
}
export function validPayload(type,p) {
 switch(type) {
 case 'init': case 'cancel-selection': case 'stop-active-recording': case 'back-to-review': return keys(p,[]);
 case 'set-mode': return keys(p,['mode'])&&['browse','draw','keyboard'].includes(p.mode);
 case 'mode-changed': return keys(p,['mode'])&&['browse','draw','keyboard'].includes(p.mode);
 case 'ready': case 'context': return keys(p,['context','recording'])&&validContext(p.context)&&typeof p.recording==='boolean';
 case 'region-selected': return keys(p,['context','anchor','capture'])&&validContext(p.context)&&validRegion(p.anchor)&&validCapture(p.capture);
 case 'render-annotations': return keys(p,['items','show'])&&typeof p.show==='boolean'&&Array.isArray(p.items)&&p.items.length<=50&&p.items.every(i=>keys(i,['id','context','anchor'])&&uuid(i.id)&&validContext(i.context)&&validRegion(i.anchor));
 case 'navigate-target': return keys(p,['id','context','anchor'])&&uuid(p.id)&&validContext(p.context)&&validRegion(p.anchor);
 case 'target-opened': case 'layout-unavailable': case 'error': return keys(p,['id','reason'])&&(p.id===null||uuid(p.id))&&str(p.reason,240);
 default:return false;
 }
}
export function envelope(session,type,payload) { return {protocol:PROTOCOL,...IDENTITY,nonce:session.nonce,generation:session.generation,requestId:crypto.randomUUID(),type,payload}; }
export function validMessage(event,expected) {
 const m=event.data;
 try { if(JSON.stringify(m).length>100000) return false; } catch { return false; }
 return event.source===expected.source&&event.origin===expected.origin&&keys(m,['protocol','skin','contentVersion','visualRevision','nonce','generation','requestId','type','payload'])&&m.protocol===PROTOCOL&&Object.entries(IDENTITY).every(([k,v])=>m[k]===v)&&uuid(m.nonce)&&uuid(m.requestId)&&Number.isSafeInteger(m.generation)&&m.generation>0&&(expected.nonce===undefined||m.nonce===expected.nonce)&&(expected.generation===undefined||m.generation===expected.generation)&&validPayload(m.type,m.payload);
}
