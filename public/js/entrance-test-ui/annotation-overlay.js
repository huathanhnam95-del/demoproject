import { envelope, validMessage, contextFor } from './annotation-model.js';
import { registry, captureRegion, captureMetadata, resolveRegion, relativeRect, absoluteRect, layoutSignature } from './annotation-anchors.js';
/** Owns only annotation DOM and input. Assessment navigation/audio are injected. */
export function createAnnotationOverlay({getContext,navigate,stopRecording,isRecording,doc=document}) {
 const win=doc.defaultView;if(win.parent===win)return {refresh(){},destroy(){}};
 const origin=win.location.origin,abort=new AbortController(),seenRequests=new Set(),seenNonces=new Set();let session=null,mode='browse',stroke=null,items=[],show=false,raf=0,draft=null,destroyed=false;
 const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('et-annotation-overlay');svg.setAttribute('aria-hidden','true');doc.body.append(svg);
 const captureLayer=doc.createElement('dialog');captureLayer.className='et-annotation-capture-layer';captureLayer.setAttribute('aria-label','Circle a region; Escape returns to Browse');doc.body.append(captureLayer);
 const picker=doc.createElement('dialog');picker.className='et-annotation-picker';picker.setAttribute('aria-label','Select region with keyboard');doc.body.append(picker);
 function send(type,payload) { if(session&&!destroyed)win.parent.postMessage(envelope(session,type,payload),origin); }
 function context(){const c=getContext();return contextFor(c.view,c.questionId,c.componentState||'');}
 function ellipse(r,label='') {const el=doc.createElementNS(svg.namespaceURI,'ellipse');el.setAttribute('cx',(r.left+r.right)/2);el.setAttribute('cy',(r.top+r.bottom)/2);el.setAttribute('rx',(r.right-r.left)/2);el.setAttribute('ry',(r.bottom-r.top)/2);svg.append(el);if(label){const t=doc.createElementNS(svg.namespaceURI,'text');t.setAttribute('x',r.left);t.setAttribute('y',Math.max(16,r.top));t.textContent=label;svg.append(t);}}
 function place(){const parent=mode==='draw'?captureLayer:doc.querySelector('#et-overview-dialog[open]')||doc.body;if(svg.parentNode!==parent)parent.append(svg);}
 function paint(){raf=0;if(destroyed)return;place();svg.setAttribute('viewBox',`0 0 ${win.innerWidth} ${win.innerHeight}`);svg.replaceChildren();if(show)items.forEach((item,i)=>{const result=resolveRegion(item,context(),doc);result.rects.forEach(r=>ellipse(r,String(i+1)));});if(draft){const result=resolveRegion(draft,context(),doc);result.rects.forEach(r=>ellipse(r,'Draft'));}if(stroke)ellipse(stroke.rect);}
 function schedule(){if(!raf&&!destroyed)raf=win.requestAnimationFrame(paint);}
 function cancel(){if(stroke){const id=stroke.id;stroke=null;if(svg.hasPointerCapture(id))svg.releasePointerCapture(id);}draft=null;schedule();}
 function setMode(next){cancel();mode=next;place();if(mode==='draw'&&!captureLayer.open)captureLayer.showModal();else if(mode!=='draw'&&captureLayer.open)captureLayer.close();svg.classList.toggle('is-drawing',mode==='draw');send('mode-changed',{mode});if(mode==='keyboard')keyboardPicker();}
 function selected(anchor){draft={context:context(),anchor};send('region-selected',{context:context(),anchor,capture:captureMetadata(doc)});mode='browse';place();if(captureLayer.open)captureLayer.close();svg.classList.remove('is-drawing');send('mode-changed',{mode});schedule();}
 function keyboardPicker(){
  picker.replaceChildren();const heading=doc.createElement('h2');heading.textContent='Select region with keyboard';picker.append(heading);
  const select=doc.createElement('select');select.setAttribute('aria-label','Semantic target');
  const map=registry(doc);for(const [id,el] of map){if(!el.getClientRects().length)continue;const option=doc.createElement('option');option.value=id;option.textContent=id;select.append(option);}picker.append(select);
  const edges={};for(const k of ['x0','y0','x1','y1']){const label=doc.createElement('label');label.textContent=k+' (percent)';const input=doc.createElement('input');input.type='number';input.min='0';input.max='100';input.step='1';input.value=k.endsWith('0')?'0':'100';input.setAttribute('aria-label',label.textContent);edges[k]=input;label.append(input);picker.append(label);}
  const hint=doc.createElement('p');hint.textContent='Choose a target, then adjust edges with arrow keys (Shift: 10%). Enter accepts. Escape cancels.';picker.append(hint);
  const error=doc.createElement('p');error.setAttribute('role','alert');picker.append(error);
  const accept=doc.createElement('button');accept.textContent='Use region';accept.type='button';accept.onclick=()=>{const el=map.get(select.value),rect=Object.fromEntries(Object.entries(edges).map(([k,input])=>[k,Number(input.value)/100]));if(!el||Object.values(rect).some(v=>!Number.isFinite(v)||v<0||v>1)||rect.x1<=rect.x0||rect.y1<=rect.y0){error.textContent='Edges must form a positive rectangle between 0 and 100%.';return;}picker.close();el.scrollIntoView({block:'center',behavior:'instant'});const id=select.value;selected({kind:id.startsWith('layout/')?'layout':'content',fragments:{f0:{kind:id.startsWith('layout/')?'layout':'element',targetId:id,rect,text:null}},layoutSignature:layoutSignature(doc),label:id});};picker.append(accept);
  const back=doc.createElement('button');back.textContent='Back to review controls';back.type='button';back.onclick=()=>{picker.close();setMode('browse');send('back-to-review',{});};picker.append(back);
  picker.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();accept.click();}if(e.shiftKey&&['ArrowUp','ArrowDown'].includes(e.key)&&Object.values(edges).includes(e.target)){e.preventDefault();e.target.value=Math.max(0,Math.min(100,Number(e.target.value)+(e.key==='ArrowUp'?10:-10)));}};
  picker.oncancel=e=>{e.preventDefault();picker.close();setMode('browse');send('back-to-review',{});};picker.showModal();select.focus();
 }
 const listen=(target,name,fn,opts={})=>target.addEventListener(name,fn,{...opts,signal:abort.signal});
 listen(svg,'pointerdown',e=>{if(mode!=='draw'||stroke||!e.isPrimary||e.button!==0)return;e.preventDefault();stroke={id:e.pointerId,x:e.clientX,y:e.clientY,rect:{left:e.clientX,right:e.clientX,top:e.clientY,bottom:e.clientY}};svg.setPointerCapture(e.pointerId);schedule();});
 listen(svg,'pointermove',e=>{if(!stroke||stroke.id!==e.pointerId)return;e.preventDefault();stroke.rect={left:Math.min(stroke.rect.left,e.clientX),right:Math.max(stroke.rect.right,e.clientX),top:Math.min(stroke.rect.top,e.clientY),bottom:Math.max(stroke.rect.bottom,e.clientY)};schedule();});
 listen(svg,'pointerup',e=>{if(!stroke||stroke.id!==e.pointerId)return;e.preventDefault();const r=stroke.rect;stroke=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);if(r.right-r.left<8||r.bottom-r.top<8){schedule();return;}try{selected(captureRegion(r,doc));}catch(error){send('error',{id:null,reason:error.message.slice(0,240)});schedule();}});
 listen(captureLayer,'cancel',e=>{e.preventDefault();setMode('browse');send('back-to-review',{});});listen(captureLayer,'wheel',e=>{e.preventDefault();if(stroke)cancel();win.scrollBy(e.deltaX,e.deltaY);},{passive:false});
 listen(svg,'pointercancel',cancel);listen(svg,'lostpointercapture',()=>{if(stroke)cancel();});listen(svg,'click',e=>{e.preventDefault();e.stopPropagation();});
 listen(win,'keydown',e=>{if(e.key==='Escape'&&mode!=='browse'&&!picker.open){e.preventDefault();setMode('browse');send('back-to-review',{});}});
 listen(doc,'scroll',()=>{if(stroke)cancel();schedule();},{capture:true,passive:true});listen(win,'resize',()=>{cancel();schedule();});
 if(win.visualViewport){listen(win.visualViewport,'resize',()=>{cancel();schedule();});listen(win.visualViewport,'scroll',schedule);}
 const observer=new ResizeObserver(schedule);observer.observe(doc.documentElement);
 if(doc.fonts)listen(doc.fonts,'loadingdone',schedule);
 listen(win,'message',async event=>{
  const init=event.data?.type==='init';if(!validMessage(event,{source:win.parent,origin,...(init?{}:session||{nonce:''})}))return;
  const m=event.data;if(seenRequests.has(m.requestId))return;seenRequests.add(m.requestId);if(seenRequests.size>512)seenRequests.delete(seenRequests.values().next().value);if(init){if(session&&m.nonce!==session.nonce&&seenNonces.has(m.nonce))return;seenNonces.add(m.nonce);if(session&&m.nonce===session.nonce&&m.generation<session.generation)return;session={nonce:m.nonce,generation:m.generation};cancel();items=[];setMode('browse');send('ready',{context:context(),recording:isRecording()});return;}
  switch(m.type){case 'set-mode':setMode(m.payload.mode);break;case 'cancel-selection':cancel();setMode('browse');break;
  case 'render-annotations':items=m.payload.items;show=m.payload.show;schedule();break;
  case 'stop-active-recording':if(isRecording())await stopRecording();break;
  case 'navigate-target': {
   cancel();const target=m.payload,captured=session;await navigate(target.context);await doc.fonts?.ready;await new Promise(r=>win.requestAnimationFrame(()=>win.requestAnimationFrame(r)));if(destroyed||captured!==session)return;
   const first=registry(doc).get(Object.values(target.anchor.fragments)[0].targetId);if(first)first.scrollIntoView({block:'center',behavior:'instant'});
   const result=resolveRegion(target,context(),doc);if(result.reason)send('layout-unavailable',{id:target.id,reason:result.reason.slice(0,240)});else {draft=target;schedule();send('target-opened',{id:target.id,reason:''});}break;
  }}
 });
 function refresh(){if(destroyed)return;if(stroke)cancel();registry(doc);send('context',{context:context(),recording:isRecording()});schedule();}
 function destroy(){destroyed=true;abort.abort();observer.disconnect();win.cancelAnimationFrame(raf);svg.remove();picker.remove();captureLayer.remove();session=null;}
 listen(doc,'toggle',refresh,{capture:true});listen(doc,'close',refresh,{capture:true});
 listen(win,'pagehide',destroy);return {refresh,destroy};
}
