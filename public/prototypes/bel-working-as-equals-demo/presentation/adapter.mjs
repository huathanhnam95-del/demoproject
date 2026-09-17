export function createPresentation({container,actor,action,close,notes,toast,resume}){
  let frame=null,last='',active=false,ready=false,applied=null;
  const message=e=>{
    if(e.source!==frame?.contentWindow||e.origin!==location.origin||!e.data?.belFrame)return;
    if(e.data.kind==='ready'){ready=true;last='';}
    if(e.data.kind==='applied')applied={slide:e.data.slide,steps:e.data.steps,finalPage:e.data.finalPage,etaOrigin:e.data.etaOrigin};
    if(e.data.kind==='error')toast(e.data.message);
    if(e.data.kind==='action'&&actor==='p0')action('slide',{action:e.data.action});
  };
  window.addEventListener('message',message);
  return {get applied(){return applied;},get ready(){return ready;},
    update(base,world){
      const should=!!base?.presentation.active;
      if(should!==active){
        active=should;container.hidden=!active;
        if(active){
          container.innerHTML='<iframe title="Original BEL presentation" allow="fullscreen"></iframe><div class="slide-tools"><span id="slide-status"></span><button data-slide="notes">Notes</button></div>';
          container.querySelector('iframe').src=new URL('../native/deck.html?_snthumb=1',import.meta.url).href;
          frame=container.querySelector('iframe');ready=false;last='';
          if(actor==='p0'){
            container.querySelector('.slide-tools').insertAdjacentHTML('beforeend','<button data-resume hidden>Resume session</button>');
            container.querySelector('[data-resume]').onclick=resume;
          }
          if(actor==='p0')container.querySelector('.slide-tools').insertAdjacentHTML('beforeend','<button data-slide="previous">Previous</button><button data-slide="next">Next</button><button data-slide="end">End presentation</button><details><summary>Appearance</summary><label><input type="checkbox" data-prop="showQuotes" checked> Quotes</label><label><input type="checkbox" data-prop="showFolio" checked> Folios</label><label>Photography <select data-prop="photoTreatment"><option>Black and white</option><option>Full colour</option></select></label></details>');
          container.querySelectorAll('[data-slide]').forEach(b=>b.onclick=()=>{const a=b.dataset.slide;if(a==='notes')notes();else if(a==='end')close();else action('slide',{action:a});});
          container.querySelectorAll('[data-prop]').forEach(el=>el.onchange=()=>action('slide',{action:'properties',values:{[el.dataset.prop]:el.type==='checkbox'?el.checked:el.value}}));
          if(actor!=='p0'){frame.tabIndex=-1;frame.style.pointerEvents='none';}
        }else{container.replaceChildren();frame=null;applied=null;}
      }
      if(active&&world){
        const str=JSON.stringify(world.deck);
        if(ready&&str!==last){last=str;frame.contentWindow.postMessage({belApp:true,deck:world.deck},location.origin);}
        const el=container.querySelector('#slide-status');if(el)el.textContent=base.pauseReasons.includes('group')?'Waiting for all four views to reconnect':`Studio ${base.presentation.roomId} · Source slide ${world.deck.slide} · ${ready?'Presenter leads':'Loading original slides…'}`;
        if(el&&base.presentation.roomId==='J')el.textContent=`${world.deck.finalPage==='eta'?'ETA':'Determine'} · Original slide 21`;
        const next=container.querySelector('[data-slide=next]');if(next)next.disabled=base.presentation.roomId==='I'&&world.reversal.phase!=='complete';
        const resumeButton=container.querySelector('[data-resume]');if(resumeButton)resumeButton.hidden=!base.pauseReasons.length;
      }
    },close(){window.removeEventListener('message',message);container.replaceChildren();}};
}
