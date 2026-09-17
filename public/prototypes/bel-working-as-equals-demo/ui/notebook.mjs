import {createDraftStore} from '../state/storage.mjs';
import {escapeHtml as esc} from './panels.mjs';
export function createNotebook(el,{sessionId,actor,client,toast,focus}){
  const draftStore=createDraftStore(localStorage,sessionId,actor),key=`bel-notebook-ui:${sessionId}:${actor}`;
  let owner=actor,index=0,editing=false,expanded=false,pageId=null,expectedVersion=0;
  const pages=()=>client.state?.players[owner]?.notes||[];
  const persistDraft=()=>{
    if(!editing||!pageId)return;
    try{draftStore.save(pageId,{title:el.querySelector('input').value,body:el.querySelector('textarea').value,expectedVersion});localStorage.setItem(key,JSON.stringify({pageId,expectedVersion}));}catch(e){toast(e.message);}
  };
  const close=()=>{persistDraft();el.hidden=true;focus();};
  function startEdit(page){
    owner=actor;editing=true;pageId=page?.id||crypto.randomUUID();expectedVersion=page?.version||0;render();
    const draft=draftStore.load(pageId);el.querySelector('input').value=draft?.title??page?.title??'';el.querySelector('textarea').value=draft?.body??page?.body??'';
    if(draft)expectedVersion=draft.expectedVersion||0;
    persistDraft();
  }
  function render(){
    el.hidden=false;if(client.state?.presentation.active)expanded=false;
    el.className=expanded?'expanded':'';
    const list=pages();index=Math.max(0,Math.min(index,list.length-1));const page=list[index],own=owner===actor;
    el.innerHTML=`<h2>${own?'Your notebook':esc(client.state.players[owner].name)+'’s notebook'}</h2>${editing?'<label>Page title<input maxlength="200" placeholder="A thought to keep"></label><label>Your writing<textarea maxlength="50000" placeholder="Write freely…"></textarea></label>':`<div class="page-turn"><b>${esc(page?.title||'A blank page, a new beginning')}</b><div class="ink">${esc(page?.body||'')}</div></div>`}<p class="small">${editing?'Draft stays in this view until saved.':own?'Saved pages · ink on paper':'Saved pages · read only'}</p><div class="notebook-nav"><button data-n="prev" ${editing?'disabled':''}>←</button><span>${list.length?index+1:0} / ${list.length}</span><button data-n="next" ${editing?'disabled':''}>→</button><button data-n="expand" ${client.state?.presentation.active?'disabled':''}>${expanded?'Compact':'Expand'}</button><button data-n="close">Close</button></div>${own?`<div class="actions">${editing?'<button data-n="save" class="primary">Save page</button>':`<button data-n="add">Add page</button>${page?'<button data-n="edit">Edit</button><button data-n="delete">Delete</button>':''}`}</div>`:''}`;
    if(editing)el.querySelectorAll('input,textarea').forEach(t=>t.oninput=persistDraft);
    el.querySelectorAll('[data-n]').forEach(b=>b.onclick=async()=>{
      const a=b.dataset.n;
      if(a==='close'){close();return;}
      if(a==='add'){startEdit();return;}
      if(a==='edit'){startEdit(page);return;}
      if(a==='expand'){persistDraft();const draft=editing?{id:pageId,version:expectedVersion}:null;expanded=!expanded;render();if(draft)startEdit(draft);return;}
      if(a==='prev'||a==='next'){index+=a==='prev'?-1:1;render();return;}
      if(a==='delete'){
        if(!confirm('Delete this saved notebook page?'))return;
        try{await client.command('notes.delete',{pageId:page.id,expectedVersion:page.version});render();}catch(e){toast(e.message);}return;
      }
      if(a==='save'){
        persistDraft();const draft=draftStore.load(pageId);const pendingKey=key+':pending';
        let envelope;try{envelope=JSON.parse(localStorage.getItem(pendingKey)||'null');}catch{}
        if(!envelope){envelope={id:crypto.randomUUID(),expectedRevision:client.state.revision,payload:{pageId,title:draft.title,body:draft.body,expectedVersion}};localStorage.setItem(pendingKey,JSON.stringify(envelope));}
        b.disabled=true;
        try{
          await client.command('notes.save',envelope.payload,{id:envelope.id,expectedRevision:envelope.expectedRevision});
          localStorage.removeItem(pendingKey);draftStore.remove(envelope.payload.pageId);localStorage.removeItem(key);editing=false;index=pages().findIndex(p=>p.id===envelope.payload.pageId);render();toast('Page saved.');
        }catch(e){
          if(e.code!=='COMMAND_OUTCOME_UNKNOWN')localStorage.removeItem(pendingKey);
          toast(e.code==='NOTE_CONFLICT'?'A newer page is saved. Your draft is kept; close and reopen the saved page before editing again.':e.message);b.disabled=false;
        }
      }
    });
  }
  return {get open(){return !el.hidden;},close,
    openFor(id=actor){persistDraft();owner=id;index=0;editing=false;expanded=false;
      if(owner===actor){let stored;try{stored=JSON.parse(localStorage.getItem(key)||'null');}catch{}
        if(stored&&draftStore.load(stored.pageId)){startEdit({id:stored.pageId,version:stored.expectedVersion});return;}
        if(!pages().length){startEdit();return;}}
      render();
    },compact(){if(expanded){persistDraft();expanded=false;render();}},dispose(){persistDraft();}};
}
