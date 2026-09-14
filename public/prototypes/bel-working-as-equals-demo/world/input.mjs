export function installInput(canvas,{interact,escape,release,blocked}){
  const keys={w:false,a:false,s:false,d:false};let lastInteract=0;
  const typing=el=>!!el?.closest?.('input,textarea,select,[contenteditable="true"]');
  const clear=()=>{for(const k in keys)keys[k]=false;};
  const down=e=>{
    if(typing(e.target))return;
    const k=e.key.toLowerCase();
    if(k==='escape'){escape();clear();return;}
    if(blocked()){clear();return;}
    if(k in keys){keys[k]=true;e.preventDefault();}
    if((k==='f'||k==='e')&&!e.repeat){e.preventDefault();if(k==='e')release();else if(Date.now()-lastInteract>350){lastInteract=Date.now();interact();}}
  };
  const up=e=>{const k=e.key.toLowerCase();if(k in keys)keys[k]=false;};
  const click=e=>{canvas.focus();if(blocked()||Date.now()-lastInteract<350)return;lastInteract=Date.now();const b=canvas.getBoundingClientRect();interact({x:(e.clientX-b.left)*1000/b.width,y:(e.clientY-b.top)*480/b.height});};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);canvas.addEventListener('click',click);
  return {keys,clear,close(){window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('click',click);}};
}
