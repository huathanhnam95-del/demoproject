// Isolate the original slide-21 node. Native DC logic continues to render its
// authored ETA fields; the adapter aligns the existing countdown to one event.
export const ETA_INITIAL=6*30*24*3600*1000;
export const etaRemaining=(origin,now)=>Math.max(0,ETA_INITIAL-Math.max(0,Math.floor((now-origin-2000)/1000))*1000);
export function createFinalAdapter(){
  let origin=null,instance=null,installed=false,clicked=null;
  const align=()=>{if(!instance||origin===null)return;const ms=etaRemaining(origin,Date.now());if(instance.state.etaMs!==ms)instance.setState({etaMs:ms});};
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
  return {apply(deck,section){
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
