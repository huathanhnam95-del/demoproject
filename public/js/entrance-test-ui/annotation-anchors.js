import { sameContext } from './annotation-model.js';
const attr='data-et-annotation-id';
export function fingerprint(text) { let h=2166136261; for(const c of text) h=Math.imul(h^c.charCodeAt(0),16777619); return (h>>>0).toString(16); }
export function relativeRect(r,b) { return {x0:Math.max(0,(r.left-b.left)/b.width),y0:Math.max(0,(r.top-b.top)/b.height),x1:Math.min(1,(r.right-b.left)/b.width),y1:Math.min(1,(r.bottom-b.top)/b.height)}; }
export function absoluteRect(r,b) { const left=b.left+r.x0*b.width,top=b.top+r.y0*b.height,right=b.left+r.x1*b.width,bottom=b.top+r.y1*b.height;return {left,top,right,bottom,width:right-left,height:bottom-top}; }
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const visible=el=>el.getClientRects().length&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0;
export function registry(doc=document) {
 const map=new Map();
 for(const el of doc.querySelectorAll(`[${attr}]`)) { const id=el.getAttribute(attr);if(map.has(id)) throw new Error(`Duplicate annotation target: ${id}`);map.set(id,el); }
 return map;
}
export function layoutSignature(doc=document) { return [doc.documentElement.lang,doc.documentElement.style.getPropertyValue('--etu-text-scale'),doc.body.style.getPropertyValue('--etu-font'),doc.defaultView.innerWidth,doc.defaultView.innerHeight].join('|'); }
function rangeFor(el,start,end) {
 const walker=el.ownerDocument.createTreeWalker(el,4); let node,offset=0,first,last;
 while((node=walker.nextNode())) {const next=offset+node.length;if(!first&&start<next) first=[node,start-offset];if(end<=next){last=[node,end-offset];break;}offset=next;}
 if(!first||!last) return null; const range=el.ownerDocument.createRange();range.setStart(...first);range.setEnd(...last);return range;
}
function textFragment(el,selection) {
 const text=el.textContent;let start=-1,end=-1;
 for(let i=0;i<text.length;i++) {const range=rangeFor(el,i,i+1);if(range&&[...range.getClientRects()].some(r=>intersects(r,selection))){if(start<0)start=i;end=i+1;}}
 if(start<0)return null;
 return {kind:'text',targetId:el.getAttribute(attr),rect:{x0:0,y0:0,x1:1,y1:1},text:{runId:el.getAttribute(attr),start,end,fingerprint:fingerprint(text),quote:text.slice(start,end).slice(0,160)}};
}
export function captureRegion(selection,doc=document) {
 const all=[...registry(doc)].filter(([,el])=>visible(el)&&intersects(selection,el.getBoundingClientRect()));
 const leaves=all.filter(([,el])=>!all.some(([,other])=>el!==other&&el.contains(other)));
 let fragments=leaves.map(([id,el])=>el.hasAttribute('data-et-text-run')?textFragment(el,selection):{kind:id.startsWith('layout/')?'layout':'element',targetId:id,rect:relativeRect(selection,el.getBoundingClientRect()),text:null}).filter(Boolean);
 if(!fragments.length||fragments.length>3) {
  const enclosing=all.filter(([,el])=>{const r=el.getBoundingClientRect();return r.left<=selection.left&&r.top<=selection.top&&r.right>=selection.right&&r.bottom>=selection.bottom;}).sort((a,b)=>{const x=a[1].getBoundingClientRect(),y=b[1].getBoundingClientRect();return x.width*x.height-y.width*y.height;})[0];
  if(!enclosing)throw new Error('Select a region inside the document');
  fragments=[{kind:'layout',targetId:enclosing[0],rect:relativeRect(selection,enclosing[1].getBoundingClientRect()),text:null}];
 }
 return {kind:fragments.some(f=>f.kind==='layout')?'layout':'content',fragments:Object.fromEntries(fragments.map((f,i)=>[`f${i}`,f])),layoutSignature:layoutSignature(doc),label:fragments.map(f=>f.targetId).join(', ').slice(0,160)};
}
export function resolveRegion(item,context,doc=document) {
 if(!sameContext(item.context,context))return {reason:'Different screen, question or disclosure state',rects:[]};
 const map=registry(doc),rects=[];
 for(const f of Object.values(item.anchor.fragments)) {
  const el=map.get(f.targetId);if(!el||!visible(el))return {reason:`Target unavailable: ${f.targetId}`,rects:[]};
  if(f.kind==='layout'&&item.anchor.layoutSignature!==layoutSignature(doc))return {reason:'Layout changed; re-anchor this layout region',rects:[]};
  if(f.kind==='text') {
   if(f.text.runId!==f.targetId||fingerprint(el.textContent)!==f.text.fingerprint||el.textContent.slice(f.text.start,f.text.end).slice(0,160)!==f.text.quote)return {reason:'Text changed; re-anchor this comment',rects:[]};
   const range=rangeFor(el,f.text.start,f.text.end);if(!range)return {reason:'Text range unavailable',rects:[]};rects.push(...range.getClientRects());
  } else rects.push(absoluteRect(f.rect,el.getBoundingClientRect()));
 }
 return {reason:'',rects};
}
export function captureMetadata(doc=document) {
 const w=doc.defaultView,v=w.visualViewport;return {frameWidth:w.innerWidth,frameHeight:w.innerHeight,scrollX:w.scrollX,scrollY:w.scrollY,visualOffsetX:v?.offsetLeft||0,visualOffsetY:v?.offsetTop||0,visualScale:v?.scale||1,locale:doc.documentElement.lang,textScale:parseFloat(doc.documentElement.style.getPropertyValue('--etu-text-scale')||'1')*100,fontEn:doc.body.style.getPropertyValue('--etu-font').slice(0,100),fontVi:doc.body.style.getPropertyValue('--etu-font').slice(0,100),buildId:'entrance-d-annotations-20260914-r1'};
}
