import { GROUPS } from '../core/content/source.mjs';

export function scopeDeck(stage, room) {
  const range = GROUPS[room];
  const sections = [...stage.children].filter(el => el.tagName === 'SECTION');
  sections.forEach((section, index) => {
    const excluded = !range || index + 1 < range[0] || index + 1 > range[1];
    section.toggleAttribute('data-deck-skip', excluded);
    section.toggleAttribute('data-room-excluded', excluded);
    section.inert = excluded;
    if (excluded) section.setAttribute('aria-hidden', 'true'); else section.removeAttribute('aria-hidden');
  });
  return range;
}

export function createFrameMessage({ roomId, revision, contentVersion, serverNow, type, payload = {} }) {
  return { source: 'bel-presentation-demo-online', roomId, revision, contentVersion, serverNow, type, payload };
}

export function acceptFrameMessage(event, { roomId, origin = window.location.origin, source = window } = {}) {
  if (event.origin !== origin || event.source !== source || event.data?.source !== 'bel-presentation-demo-online' || event.data.roomId !== roomId) return null;
  return event.data;
}

// Isolate the original slide-21 node. Native DC logic continues to render its
// authored ETA fields; the adapter aligns the existing countdown to one event.
const ETA_INITIAL=6*30*24*3600*1000;
const etaRemaining=(origin,now)=>Math.max(0,ETA_INITIAL-Math.max(0,Math.floor((now-origin-2000)/1000))*1000);
function createOnlineFinalAdapter(){
  let serverOrigin=0,observedAt=performance.now();
  const serverNow=()=>serverOrigin+(performance.now()-observedAt);
  let origin=null,instance=null,installed=false,clicked=null;
  const align=()=>{if(!instance||origin===null)return;const ms=etaRemaining(origin,serverNow());if(instance.state.etaMs!==ms)instance.setState({etaMs:ms});};
  const timer=setInterval(align,100);
  function capture(){
    if(installed)return;const proto=window.__dcRegistry?.[window.__dcRootName()]?.Logic?.prototype;
    if(typeof proto?.startEta!=='function')throw Error('Native ETA handler unavailable');
    const original=proto.startEta;
    proto.startEta=function(){instance=this;original.call(this);clearTimeout(this._etaDelay);clearInterval(this._etaTick);align();};installed=true;
  }
  const style=document.createElement('style');style.textContent=`
    section[data-final-page="determine"] [data-eta-banner]{opacity:0!important;visibility:hidden!important}
    section[data-final-page="eta"] [data-final-hidden]{display:none!important}
    section[data-final-page="eta"] [data-final-content]{justify-content:center!important}
    section[data-final-page="eta"] [data-eta-banner]{margin-top:0!important}
  `;document.head.append(style);
  return {setServerTime(value){if(Number.isFinite(value)){serverOrigin=value;observedAt=performance.now();}},apply(deck,section){
    if(deck.room!=='J')return;
    capture();const banner=section.querySelector('[data-eta-banner]'),content=banner.parentElement,left=content.parentElement;
    content.setAttribute('data-final-content','');
    for(const sibling of content.children)if(sibling!==banner)sibling.setAttribute('data-final-hidden','');
    for(const sibling of left.children)if(sibling!==content&&sibling!==left.firstElementChild)sibling.setAttribute('data-final-hidden','');
    section.dataset.finalPage=deck.finalPage||'determine';origin=deck.etaOrigin??null;
    if(origin!==null&&clicked!==origin){clicked=origin;section.querySelector('button').click();}
    align();
  },close(){clearInterval(timer);style.remove();}};
}

if (typeof window !== "undefined" && typeof document !== "undefined" && window.parent !== window) {
// App-owned bridge. Authored HTML, runtime, styles and native handlers are retained.

const final=createOnlineFinalAdapter();
let pending=null,applying=false,stage=null,steps={2:1,4:1,5:1,6:1},properties='',roomId=null,revision=-1,canControl=false,currentDeck=null;
const tell=message=>parent.postMessage({belFrame:true,roomId,revision,contentVersion:'bel-working-as-equals-1',...message},location.origin);
const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
async function apply(){
  if(applying||!stage||typeof stage.goTo!=='function'||stage.length!==21||!pending)return;applying=true;
  try{
    while(pending){
      const state=pending;pending=null;
      const range=scopeDeck(stage,state.room);
      if(!range||state.slide<range[0]||state.slide>range[1])continue;
      currentDeck=state;
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
      const root=stage.shadowRoot;
      if(root){
        const prev=root.querySelector('.prev'),next=root.querySelector('.next');
        if(prev)prev.disabled=!canControl||(state.room==='J'?state.finalPage!=='eta':state.slide===range[0]);
        if(next)next.disabled=!canControl||(state.room==='J'?state.finalPage==='eta':state.slide===range[1]);
        const count=root.querySelector('.current'),total=root.querySelector('.total');
        if(count)count.textContent=String(state.slide-range[0]+1);
        if(total)total.textContent=String(range[1]-range[0]+1);
      }
    }
  }catch(e){tell({kind:'error',message:e.message});}finally{applying=false;}
}
window.addEventListener('message',e=>{
  const data=e.data;
  if(e.source!==parent||e.origin!==location.origin||!data?.belApp||data.contentVersion!=='bel-working-as-equals-1'||typeof data.roomId!=='string'||!Number.isSafeInteger(data.revision))return;
  if(roomId!==null&&(data.roomId!==roomId||data.revision<revision))return;
  roomId=data.roomId;revision=data.revision;canControl=data.canControl===true;
  if(data.deck){final.setServerTime(data.serverNow);pending=data.deck;apply();}
});
// All physical input is routed back through the presenter-authorized world action.
window.addEventListener('keydown',e=>{
  if(e.target.closest?.('input,textarea,select'))return;
  e.stopImmediatePropagation();e.preventDefault();if(e.repeat||!canControl)return;
  if(e.key==='Escape'){tell({kind:'action',action:'close'});return;}
  const k=e.key;if(['ArrowRight','ArrowDown','PageDown',' '].includes(k))tell({kind:'action',action:'next'});
  if(['ArrowLeft','ArrowUp','PageUp'].includes(k))tell({kind:'action',action:'previous'});
  if(k.toLowerCase()==='r')tell({kind:'action',action:'reset-view'});
},true);
window.addEventListener('click',e=>{
  if(applying&&!e.isTrusted)return;
  const path=e.composedPath();const button=path.find(n=>n.tagName==='BUTTON');
  e.stopImmediatePropagation();e.preventDefault();
  if(!canControl)return;
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
  const scopeStyle=document.createElement('style');scopeStyle.textContent='section[data-room-excluded]{display:none!important}';document.head.append(scopeStyle);
  scopeDeck(stage,null);
  // Native nodes/handlers remain mounted so their animations and reveal state
  // survive. Navigation is restricted to the server-selected room and slide.
  const go=stage.goTo.bind(stage);
  stage.goTo=index=>{if(currentDeck&&index===currentDeck.slide-1)go(index);};
  window.addEventListener('hashchange',()=>{if(currentDeck)go(currentDeck.slide-1);});
  tell({kind:'ready'});apply();
},80);
setTimeout(()=>{if(!stage)tell({kind:'error',message:'Native deck did not load. Check source and CDN availability.'});},20000);

}
