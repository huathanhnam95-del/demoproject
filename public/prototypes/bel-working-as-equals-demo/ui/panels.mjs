import {HEADINGS,GROUPS} from '../content/source.mjs';
export const escapeHtml=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createPanels(el,{source,act,base,world,actor,notes,command,toast,focus,modal}){
  // Popups are part of the world, not browser chrome: they live inside
  // #world-wrap and dim the play area behind them like an in-game prompt.
  const wrap=el.parentElement;
  const dim=on=>wrap?.classList.toggle('dimmed',Boolean(on));
  const close=()=>{el.hidden=true;el.className='';dim(false);if(modal?.open)modal.close();focus();};
  const show=(html,variant='')=>{const cls=variant===true?'radial':(variant||'');el.hidden=false;el.className=cls;el.innerHTML=html;dim(cls==='');};
  const closeButton=()=>{el.querySelector('[data-close]').onclick=close;};
  const actions='<div class="actions"><button data-close>Close · Esc</button></div>';
  return {get open(){return !el.hidden||Boolean(modal?.open);},close,
    show(result){
      if(result.kind==='toast'){toast(result.text);return;}
      if(result.kind==='notes'){close();notes(result.owner);return;}
      if(result.kind==='profile'){
        const p=base().players[actor];show(`<h2>Your character</h2><form class="form-grid"><label>Name<input name="name" maxlength="80" value="${escapeHtml(p.name)}" required></label><label>Clothing<select name="shirt">${['teal','cream','amber','red'].map(v=>`<option ${p.appearance.shirt===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Hat<select name="hat">${['none','straw','cap'].map(v=>`<option ${p.appearance.hat===v?'selected':''}>${v}</option>`).join('')}</select></label><label><span><input type="checkbox" name="glasses" ${p.appearance.glasses?'checked':''}> Glasses</span></label><div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Save character</button></div></form>`);
        closeButton();el.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await command('profile.set',{name:f.get('name'),appearance:{shirt:f.get('shirt'),hat:f.get('hat'),glasses:f.has('glasses')}});close();}catch(e){toast(e.message);}};return;
      }
      if(result.kind==='reflection'){
        const s=source.routes[result.route],i=result.index;show(`<h2>${escapeHtml(s.title)}</h2><h3>${HEADINGS[i]}</h3><p class="source-text ${i===2?'shift':''}">${escapeHtml(s.sections[i])}</p><p class="small">Slide ${String(s.slide).padStart(2,'0')} · ${result.route}</p>${actions}`);
        el.className='reflection';dim(false);localStorage.setItem(`bel-read:${location.search}:${actor}:${result.route}:${i}`,'read');closeButton();
        if(modal)modal.showReflection({title:s.title,heading:HEADINGS[i],text:s.sections[i],slide:s.slide,route:result.route,onClose:close});
        return;
      }
      if(result.kind==='portrait'){
        const s=source.gallery[result.index];show(`<div class="portrait-head"><img src="${s.image}" alt="${s.name}"><h2>${s.name}</h2></div><p class="attribution">${escapeHtml(s.attribution)}</p><blockquote>${escapeHtml(s.quote)}</blockquote>${s.paragraphs.map(p=>`<p>${escapeHtml(p)}</p>`).join('')}<p class="small">Attributed content from original slide ${s.slide}</p>${actions}`);closeButton();
        if(modal)modal.showPortrait({name:s.name,image:s.image,attribution:s.attribution,quote:s.quote,paragraphs:s.paragraphs,slide:s.slide,onClose:close});
        return;
      }
      if(result.kind==='door'){
        const route=source.routes[result.to];const title=route?.title||({street:'Street · Better English Learning',home:'Your Home',reception:'Reception',A:'Studio A',C:'Studio C',D:'Gallery D',E:'Studio E',F:'Bridge room',G:'Studio G',I:'Room I',J:'Cube matching / J'}[result.to]);
        show(`<p class="eyebrow">THROUGH THIS DOOR</p><h2>${escapeHtml(title)}</h2><p>Enter when you are ready. Your notes travel with you.</p><div class="actions"><button data-close>Stay</button><button class="primary" data-enter>Enter</button></div>`);closeButton();el.querySelector('[data-enter]').onclick=async()=>{const r=await act('enter',{target:result.target});if(r)close();};return;
      }
      if(result.kind==='person'){
        const name=base().players[result.owner].name;
        show(`<h2>${escapeHtml(name)}</h2><button data-social="notes">View notes</button><button data-social="hi">Say hi</button><button data-social="hold">Hold hands</button><button class="radial-close" aria-label="Close people menu" data-close>×</button>`,true);closeButton();el.querySelectorAll('[data-social]').forEach(b=>b.onclick=async()=>{close();const r=await act('social',{target:result.owner,action:b.dataset.social});if(r?.kind==='notes')notes(r.owner);});return;
      }
      if(result.kind==='monitor'){
        if(actor!=='p0'){toast('The presenter operates this monitor. You can sit or take notes.');return;}
        if(result.room==='J'&&(!world().cubes.pairs.every(Boolean)||!GROUPS.J)){toast(world().cubes.pairs.every(Boolean)?'The closing presentation is being prepared.':'Complete all three cube matches to enable the final presentation.');return;}
        const s=base(),missing=Object.values(s.players).filter(p=>!p.connected||!p.ready||p.location.sceneId!==result.room).map(p=>p.name);
        show(`<h2>Studio ${result.room}</h2><p>${missing.length?'Waiting for: '+missing.map(escapeHtml).join(', '):'All three participants are here. Ready when you are.'}</p><p class="small">Original slides ${GROUPS[result.room].join('–')} · movement pauses while you present. Personal notes stay available.</p><div class="actions"><button data-close>Close</button><button data-start class="primary" ${missing.length?'disabled':''}>Start presentation</button></div>`);closeButton();el.querySelector('[data-start]').onclick=async()=>{try{await command('presentation.open',{roomId:result.room});close();}catch(e){toast(e.message);}};return;
      }
    },
    help(){show(`<h2>Make yourself at home</h2><p><b>WASD</b> to walk. Approach an object or colleague, then press <b>F</b> or click.</p><p>Hold one shape at a time. Match it to its pedestal to read the original passage. Put down is always available.</p><p>Choose a free seat with F. Press F again to stand. While holding hands, the initiator leads; either person can press <b>E</b> to let go.</p><p>Saved notebook pages are readable by nearby colleagues. Your unfinished writing stays in your own notebook.</p><p class="small">One local Chrome profile, four views. Keep the presenter window open. If it reloads, rejoin all views and use Presenter → Pause / Resume.</p>${actions}`);closeButton();}
  };
}
