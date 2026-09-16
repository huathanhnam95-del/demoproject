export function installInput(canvas,{interact,escape,release,blocked,onChange}){
  const keys={w:false,a:false,s:false,d:false};let lastInteract=0;
  const activeKeys=new Set();
  const keyMap={w:'w',arrowup:'w',a:'a',arrowleft:'a',s:'s',arrowdown:'s',d:'d',arrowright:'d'};
  const typing=el=>!!el?.closest?.('input,textarea,select,[contenteditable="true"]');
  const notify=()=>{if(typeof onChange==='function')onChange({...keys});};
  const updateKeys=()=>{
    const nw=activeKeys.has('w')||activeKeys.has('arrowup');
    const na=activeKeys.has('a')||activeKeys.has('arrowleft');
    const ns=activeKeys.has('s')||activeKeys.has('arrowdown');
    const nd=activeKeys.has('d')||activeKeys.has('arrowright');
    if(keys.w!==nw||keys.a!==na||keys.s!==ns||keys.d!==nd){
      keys.w=nw;keys.a=na;keys.s=ns;keys.d=nd;
      notify();
    }
  };
  const clear=()=>{if(activeKeys.size>0||keys.w||keys.a||keys.s||keys.d){activeKeys.clear();updateKeys();}};
  const down=e=>{
    if(typing(e.target))return;
    const raw=e.key?e.key.toLowerCase():'';
    if(!raw)return;
    if(raw==='escape'){escape();clear();return;}
    if(blocked()){clear();return;}
    if(raw in keyMap){
      e.preventDefault();
      if(!activeKeys.has(raw)){activeKeys.add(raw);updateKeys();}
    }
    if((raw==='f'||raw==='e')&&!e.repeat){e.preventDefault();if(raw==='e')release();else if(Date.now()-lastInteract>350){lastInteract=Date.now();interact();}}
  };
  const up=e=>{
    const raw=e.key?e.key.toLowerCase():'';
    if(raw&&activeKeys.has(raw)){
      activeKeys.delete(raw);
      updateKeys();
    }
  };
  const click=e=>{canvas.focus();if(blocked()||Date.now()-lastInteract<350)return;lastInteract=Date.now();const b=canvas.getBoundingClientRect();const w=b.width||1000,h=b.height||480;interact({x:(e.clientX-b.left)*1000/w,y:(e.clientY-b.top)*480/h});};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);canvas.addEventListener('click',click);
  return {keys,clear,close(){window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('click',click);}};
}
