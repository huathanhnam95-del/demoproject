import {createSession} from './state/session.mjs';
import {createHost,createClient} from './state/protocol.mjs';
import {createHostStore,createResumeStore} from './state/storage.mjs';
import {createWorldHost,createWorldClient} from './world/network.mjs';
import {createRenderer} from './world/renderer.mjs';
import {installInput} from './world/input.mjs';
import {nearest,targets} from './world/simulation.mjs';
import {SCENES} from './world/scenes.mjs';
import {distance} from './world/geometry.mjs';
import {createPanels,escapeHtml} from './ui/panels.mjs';
import {createNotebook} from './ui/notebook.mjs';
import {loadSource} from './content/source.mjs';
import {createPresentation} from './presentation/adapter.mjs';
import {QUESTIONS} from './activities/reversal.mjs';
const $=s=>document.querySelector(s);
let client,host,worldHost,worldClient,input,notebook,panels,presentation,timer,animation,disposed=false;
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
async function boot(invite,initialBundle){
  const {sessionId,actorId:actor}=invite;
  createResumeStore(sessionStorage,sessionId).save(invite);
  if(actor==='p0'){
    host=await createHost({sessionId,initialBundle,ownerToken:invite.token,store:createHostStore(localStorage,sessionId)});
    worldHost=createWorldHost(host);
  }
  client=createClient(invite);worldClient=createWorldClient(invite,client);
  const [renderer,source]=await Promise.all([createRenderer($('#world')),loadSource()]);
  $('#launcher').hidden=true;$('#game').hidden=false;
  const focus=()=>{input?.clear();$('#world').focus();};
  const command=(type,payload)=>client.command(type,payload);
  async function act(type,payload={}){
    try{const w=worldClient.state,me=w?.players[actor];const result=await worldClient.action(type,{instance:me?.instance,generation:me?.scene==='F'?w.bridge.generation:undefined,...payload});if(result.kind==='toast')toast(result.text);return result;}
    catch(e){toast(e.message);return null;}
  }
  notebook=createNotebook($('#notebook'),{sessionId,actor,client,toast,focus});
  panels=createPanels($('#panel'),{source,act,base:()=>client.state,world:()=>worldClient.state,actor,notes:id=>notebook.openFor(id),command,toast,focus});
  const blocked=()=>client.paused||!worldClient.available||panels.open||notebook.open;
  input=installInput($('#world'),{blocked,escape(){panels.close();if(!$('#notebook').hidden)notebook.close();},release:()=>act('release'),
    async interact(point){
      const w=worldClient.state;if(!w)return;const p=w.players[actor];let t;
      if(point)t=targets(w,actor).filter(t=>distance(t,point)<37&&distance(t,p)<=48).sort((a,b)=>distance(a,point)-distance(b,point))[0];
      else t=nearest(w,actor);
      if(!t){if(point)toast('Walk closer, then press F or click.');else if(p.ride)act('dismount');else if(p.carry)act('drop');return;}
      const r=await act('interact',{target:t.id});if(r)panels.show(r);
    }});
  presentation=createPresentation({container:$('#presentation'),actor,action:act,notes:()=>notebook.openFor(actor),toast,resume:async()=>{try{await command('session.resume',{});}catch(e){toast(e.message);}},close:async()=>{try{await command('presentation.close',{});focus();}catch(e){toast(e.message);}}});
  $('#notes-button').onclick=()=>notebook.openFor(actor);
  $('#help-button').onclick=()=>panels.help();$('#profile-button').onclick=()=>panels.show({kind:'profile'});
  $('#release-button').onclick=()=>act('release');$('#drop-button').onclick=()=>act('drop');$('#dismount-button').onclick=()=>act('dismount');
  document.querySelectorAll('[data-activity]').forEach(b=>b.onclick=()=>act('activity',{action:b.dataset.activity}));
  if(host){
    $('#presenter-tools').hidden=false;
    for(const id of ['p1','p2','p3']){
      const inv=host.invite(id),url=new URL(location.href);url.search=`?session=${sessionId}&actor=${id}`;url.hash=new URLSearchParams({token:inv.token}).toString();
      const link=document.createElement('a');link.href=url.href;link.textContent=`Open participant ${id[1]}`;link.dataset.actor=id;link.onclick=e=>{e.preventDefault();window.open(url.href,`bel-${sessionId}-${id}`,'popup,width=1280,height=800');};$('#invite-links').append(link);
    }
    $('#pause-button').onclick=async()=>{try{await command(client.state.pauseReasons.length?'session.resume':'session.pause',{});}catch(e){toast(e.message);}};
    $('#continue-button').onclick=async()=>{if(confirm('Gather all four people at the next entrance? This rehearsal control skips the current section.'))await act('skip');};
  }
  let readyKey='',loading=false,request=null,lastInstance=null;
  timer=setInterval(()=>{
    if(disposed)return;
    const base=client.state,w=worldClient.state;if(!base||!w)return;
    const me=w.players[actor],self=base.players[actor],loadKey=`${self.location.instanceId}:${self.loadRevision}`;
    const bridge=w.bridge,bridgeView=me.scene==='F',canReset=host&&!w.gStarted&&['F','G'].includes(me.scene);
    $('#activity-controls').hidden=!canReset;
    $('#bridge-start').hidden=!bridgeView||bridge.phase!=='gathering';
    $('#bridge-start').disabled=Object.values(base.players).some(p=>!p.connected||!p.ready||w.players[p.id].scene!=='F');
    $('#bridge-skip').hidden=!bridgeView||!['preparation','attempt','review'].includes(bridge.phase);
    $('#activity-status').hidden=!bridgeView;
    if(bridgeView){const label={gathering:'Waiting for the group',preparation:'Preparation',attempt:'Team attempt',review:'Team review',complete:bridge.assisted?'Bridge complete · presenter assisted':'Bridge complete'}[bridge.phase];$('#activity-status').textContent=label+(['gathering','complete'].includes(bridge.phase)?'':`  ${String(Math.floor(Math.ceil(bridge.remaining/1000)/60)).padStart(2,'0')}:${String(Math.ceil(bridge.remaining/1000)%60).padStart(2,'0')}`);}
    if(me.scene==='I'){
      const r=w.reversal;$('#activity-status').hidden=false;$('#activity-status').textContent=({gathering:'Gathering',opening:'Read',choice:'Choose',interval:'Next statement',complete:'Activity complete'})[r.phase]+(['gathering','complete'].includes(r.phase)?'':` 00:${String(Math.ceil(r.remaining/1000)).padStart(2,'0')}`);
      $('#activity-controls').hidden=!host;$('#bridge-start').hidden=r.phase!=='gathering';$('#bridge-start').textContent='Start activity';$('#bridge-start').disabled=Object.values(base.players).some(p=>!p.connected||!p.ready||w.players[p.id].scene!=='I');$('#bridge-skip').hidden=true;
    }else $('#bridge-start').textContent='Start preparation';
    $('#bridge-reset').hidden=me.scene==='I';
    if(!loading&&self.connected&&!self.ready&&self.location.instanceId===me.instance&&readyKey!==loadKey){
      loading=true;const payload={...self.location,loadRevision:self.loadRevision};delete payload.atScreen;
      command('player.ready',payload).then(()=>{readyKey=loadKey;}).catch(e=>toast(e.message)).finally(()=>loading=false);
    }
    if(lastInstance!==me.instance){panels.close();input.clear();lastInstance=me.instance;}
    input&&worldClient.input(input.keys,blocked());
    $('#room-name').textContent=SCENES[me.scene].title;$('#identity').textContent=`${self.name} · ${actor==='p0'?'Presenter':'Participant'}`;
    const target=nearest(w,actor);$('#prompt').textContent=me.leader?`Following ${base.players[me.leader].name} · E to let go`:me.seat?'F · Stand':me.carry?`${me.carry.replace('shape-','Shape ')} in hand · ${target?.label||'Carry to a matching pedestal'}`:target?`F · ${target.type==='person'?base.players[target.id].name:target.label}`:me.ride?'WASD · Ride / coast':'Explore at your own pace';
    if(me.scene==='J'){
      $('#activity-status').hidden=false;$('#activity-status').textContent=w.cubes.pairs.every(Boolean)?'Three pairs complete':'Match the cubes';
      $('#prompt').textContent=me.carry?(target?.type==='person'&&w.players[target.id].carry?`F · Match cubes with ${base.players[target.id].name}`:'Meet another player carrying a cube.'):w.cubes.pairs.every(Boolean)?'All three objectives are revealed. Gather at the monitor.':target?.type==='cube'?`F · ${target.label}`:'Pick up a cube, then meet another carrier.';
    }
    if(bridgeView&&!me.leader)$('#prompt').textContent=me.carry?'Carry to the next bridge position · F to place':target?`F · ${target.label}`:({preparation:'Read and think for one minute.',attempt:'Build the six thoughts in order.',review:'Review together. The next attempt starts soon.',complete:'Walk across the bridge to continue.',gathering:'Gather here. The presenter will start.'}[bridge.phase]);
    if(me.scene==='I'){
      const r=w.reversal,last=r.results.at(-1),result=last?.players[actor];$('#prompt').textContent=me.leader?'Let go with E to make an independent choice.':['interval','complete'].includes(r.phase)?`${result?(result.choice===null?'No choice recorded. ':result.correct?'':'That choice missed the meaning. '):''}${QUESTIONS[r.index][3]}`:'Move fully into Do or Don’t before the timer ends.';
    }
    $('#release-button').hidden=!me.leader&&!me.follower;$('#drop-button').hidden=!me.carry;$('#dismount-button').hidden=!me.ride;
    const status=worldClient.error||(!worldClient.available?'Connecting to presenter…':client.paused&&!base.presentation.active?'World paused · presenter can resume when all views are ready.':'');$('#connection').hidden=!status;$('#connection').textContent=status;
    if(request!==me.request){request=me.request;const box=$('#pair-request');box.hidden=!request;if(request){box.innerHTML=`<p>${escapeHtml(base.players[request].name)} would like to hold hands.</p><button data-accept>Accept</button> <button data-decline>Decline</button>`;box.querySelector('[data-accept]').onclick=()=>act('accept');box.querySelector('[data-decline]').onclick=()=>act('decline');}}
    presentation.update(base,w);if(base.presentation.active){input.clear();notebook.compact();}
    $('#presentation').classList.toggle('with-notes',base.presentation.active&&notebook.open);
    document.body.dataset.scene=me.scene;document.body.dataset.ready=String(self.ready);document.body.dataset.actor=actor;
  },60);
  function draw(){if(disposed)return;const w=worldClient.state,base=client.state;if(w&&base)renderer.draw(w,base,actor,Date.now(),source);animation=requestAnimationFrame(draw);}draw();
  // Observation-only surface for local acceptance: every call returns a copy.
  Object.defineProperty(window,'belDebug',{configurable:true,value:Object.freeze({snapshot:()=>structuredClone({session:client.state,world:worldClient.state,status:client.status,paused:client.paused,actor,deck:presentation.applied,frameReady:presentation.ready,target:worldClient.state?nearest(worldClient.state,actor):null})})});
  focus();
}
$('#create-session').onclick=async()=>{
  const id='bel-'+crypto.randomUUID();const bundle=createSession({id});
  const invite={sessionId:id,actorId:'p0',token:bundle.credentials.p0};
  history.replaceState(null,'',`?session=${id}&actor=p0`);
  try{await boot(invite,bundle);}catch(e){$('#launch-error').textContent=e.message;}
};
async function resume(){
  const params=new URLSearchParams(location.search),sessionId=params.get('session'),actorId=params.get('actor');if(!sessionId)return;
  const resumeStore=createResumeStore(sessionStorage,sessionId);let invite=resumeStore.load();
  const token=new URLSearchParams(location.hash.slice(1)).get('token');if(token){invite={sessionId,actorId,token};resumeStore.save(invite);history.replaceState(null,'',location.pathname+location.search);}
  if(!invite){$('#launch-error').textContent='Open the original presenter view or use its invitation link to rejoin. No saved session has been overwritten.';return;}
  try{await boot(invite);}catch(e){$('#launch-error').textContent=e.message;}
}
resume();
function dispose(){if(disposed)return;disposed=true;clearInterval(timer);cancelAnimationFrame(animation);notebook?.dispose();input?.close();presentation?.close();worldClient?.close();client?.close();worldHost?.close();host?.close();}
window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
