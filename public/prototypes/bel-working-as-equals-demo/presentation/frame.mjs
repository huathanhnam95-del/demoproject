// App-owned bridge. Authored HTML, runtime, styles and native handlers are retained.
import {createFinalAdapter} from './final.mjs';
const final=createFinalAdapter();
let pending=null,applying=false,stage=null,steps={2:1,4:1,5:1,6:1},properties='';
const tell=message=>parent.postMessage({belFrame:true,...message},location.origin);
const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
async function apply(){
  if(applying||!stage||!pending)return;applying=true;
  try{
    while(pending){
      const state=pending;pending=null;
      stage.goTo(state.slide-1);
      if(JSON.stringify(state.properties)!==properties){properties=JSON.stringify(state.properties);window.__dcSetProps?.(window.__dcRootName(),state.properties);await waitFrame();}
      for(const n of [2,4,5,6]){
        const desired=state.steps[n],cycle=n===2?3:4;
        for(let i=0;steps[n]!==desired&&i<cycle;i++){
          // deck-stage expands screen labels (for example "02 Where we are
          // today") after mounting. Source order is the stable native contract.
          const s=[...stage.children].filter(el=>el.tagName==='SECTION')[n-1];
          s.querySelector('button').click();steps[n]=steps[n]%cycle+1;await waitFrame();
        }
      }
      stage.goTo(state.slide-1);final.apply(state,[...stage.children].filter(el=>el.tagName==='SECTION')[20]);await waitFrame();tell({kind:'applied',slide:state.slide,steps:{...steps},finalPage:state.finalPage,etaOrigin:state.etaOrigin});
    }
  }catch(e){tell({kind:'error',message:e.message});}finally{applying=false;}
}
window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||!e.data?.belApp)return;if(e.data.deck){pending=e.data.deck;apply();}});
// All physical input is routed back through the presenter-authorized world action.
window.addEventListener('keydown',e=>{
  if(e.target.closest?.('input,textarea,select'))return;
  e.stopImmediatePropagation();e.preventDefault();if(e.repeat)return;
  const k=e.key;if(['ArrowRight','ArrowDown','PageDown',' '].includes(k))tell({kind:'action',action:'next'});
  if(['ArrowLeft','ArrowUp','PageUp'].includes(k))tell({kind:'action',action:'previous'});
  if(k.toLowerCase()==='r')tell({kind:'action',action:'reset-view'});
},true);
window.addEventListener('click',e=>{
  if(applying&&!e.isTrusted)return;
  const path=e.composedPath();const button=path.find(n=>n.tagName==='BUTTON');
  e.stopImmediatePropagation();e.preventDefault();
  if(button?.closest?.('section[data-deck-active]'))tell({kind:'action',action:'reveal'});
  else if(button?.classList.contains('next'))tell({kind:'action',action:'next'});
  else if(button?.classList.contains('prev'))tell({kind:'action',action:'previous'});
  else if(button?.classList.contains('reset'))tell({kind:'action',action:'reset-view'});
},true);
const timer=setInterval(()=>{
  stage=document.querySelector('deck-stage');if(!stage||stage.length!==21)return;
  clearInterval(timer);stage.setAttribute('no-rail','');
  // Native chrome remains intact, except editing and whole-deck reset controls.
  const style=document.createElement('style');style.textContent='.reset{display:none!important}';stage.shadowRoot?.append(style);
  tell({kind:'ready'});apply();
},80);
setTimeout(()=>{if(!stage)tell({kind:'error',message:'Native deck did not load. Check source and CDN availability.'});},20000);
