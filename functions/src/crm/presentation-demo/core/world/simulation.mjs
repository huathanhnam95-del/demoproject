import {SCENES,SHAPES,instance,entry} from './scenes.mjs';
import {distance,move,safeAnchor,vector} from './geometry.mjs';
import {GROUPS} from '../content/source.mjs';
import {createBridge,tickBridge,bridgeControl,bridgeInteract,plankPosition} from '../activities/bridge.mjs';
import {createReversal,tickReversal,startReversal} from '../activities/reversal.mjs';
import {createCubes,claimCube,matchCubes} from '../activities/cubes.mjs';
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
export function createWorld(session){
  return {version:1,sessionId:session.id,revision:0,unlocked:{A:false,C:false,E:false,G:false,I:false},cStarted:false,gStarted:false,bridge:createBridge(),reversal:createReversal(),cubes:createCubes(),
    presentationWas:null,deck:{room:null,slide:1,steps:{2:1,4:1,5:1,6:1},finalPage:'determine',etaOrigin:null,properties:{showQuotes:true,showFolio:true,photoTreatment:'Black and white'}},
    players:Object.fromEntries(Object.values(session.players).map(p=>[p.id,{id:p.id,scene:p.location.sceneId,instance:p.location.instanceId,
      ...SCENES[p.location.sceneId].spawn,facing:'down',pose:'idle',ride:null,selectedRide:null,seat:null,carry:null,
      leader:null,follower:null,request:null,waveUntil:0,resetUntil:0,lastRoute:'B1',distance:0}])),
    routes:Object.fromEntries(['B1','B2','B3'].map(id=>[id,SHAPES.map((shape,i)=>({id:`shape-${i}`,shape,index:i,...SCENES[id].shapeSpawns[i],owner:null,placed:false}))]))};
}
export function solidsFor(w,id,ignorePlayers=false){
  const p=w.players[id],scene=SCENES[p.scene];
  const solids=scene.solids.filter(r=>r.id!==p.seat);
  if(p.scene==='F'&&w.bridge.placed<6)solids.push({id:'missing-bridge',x:459,y:145,w:82,h:96-w.bridge.placed*16});
  if(p.scene==='home') for(const [ride,x]of [['scooter',380],['skateboard',622]]) if(p.ride!==ride) solids.push({id:ride,x:x-28,y:352,w:56,h:14});
  if(!ignorePlayers) for(const other of Object.values(w.players)) if(other.id!==id&&other.instance===p.instance&&other.connected!==false) solids.push({id:other.id,x:other.x-10,y:other.y-10,w:20,h:20});
  return solids;
}
export function targets(w,id){
  const p=w.players[id];
  return [...SCENES[p.scene].targets,
    ...(p.scene==='F'?[...w.bridge.planks.filter(o=>!o.placed&&!o.owner).map(o=>({...o,type:'plank',label:`Inspect ${o.color} / ${o.mark} plank`})),...(w.bridge.placed<6?[{id:'bridge-next',type:'bridge',...plankPosition(w.bridge.placed),label:'Place in the next open position'}]:[])]:[]),
    ...(p.scene==='J'?w.cubes.cubes.filter(o=>!o.owner&&!o.placed).map(o=>({...o,type:'cube',label:`Pick up ${o.color} / ${o.mark} cube`})):[]),
    ...(w.routes[p.scene]||[]).filter(o=>!o.placed&&!o.owner).map(o=>({...o,type:'shape',label:`Pick up ${o.shape}`})),
    ...Object.values(w.players).filter(q=>q.id!==id&&q.instance===p.instance&&q.connected!==false).map(q=>({id:q.id,type:'person',x:q.x,y:q.y,label:'Interact with player'}))];
}
export function nearest(w,id){const p=w.players[id];return targets(w,id).filter(t=>distance(p,t)<=48).sort((a,b)=>distance(p,a)-distance(p,b))[0]||null;}
export function monitorPresence(player,connected,world){
  const screen=SCENES[player.scene].targets.find(t=>t.type==='monitor');
  if(player.scene==='J'&&!world?.cubes.pairs.every(Boolean))return false;
  return player.id==='p0'&&connected===true&&!!screen&&distance(player,screen)<=48;
}
export function release(w,id){
  const p=w.players[id];
  if(p.leader) w.players[p.leader].follower=null;
  if(p.follower) w.players[p.follower].leader=null;
  p.leader=null;p.follower=null;p.request=null;
}
export function drop(w,id){
  const p=w.players[id];if(!p.carry)return;
  const o=(p.scene==='F'?w.bridge.planks:p.scene==='J'?w.cubes.cubes:w.routes[p.scene]).find(o=>o.id===p.carry);
  Object.assign(o,safeAnchor({x:p.x+27,y:p.y+10},SCENES[p.scene],solidsFor(w,id)),{owner:null});p.carry=null;p.inspect=null;
}
export function transition(w,id,to,now=Date.now()){
  const p=w.players[id],from=p.scene;
  drop(w,id);p.seat=null;
  if(from.startsWith('B'))p.lastRoute=from;
  if(to==='route')to=p.lastRoute;
  ensure(SCENES[to],'The next room is being integrated.');
  if(to==='reception')p.ride=null;
  if(to!=='home'&&to!=='street')p.ride=null;
  Object.assign(p,{scene:to,instance:instance(id,to),pose:'idle',inspect:null});
  Object.assign(p,safeAnchor(entry(to,id,from),SCENES[to],solidsFor(w,id)));
  p.transitionUntil=now+500;
}
export function carsAt(now){
  return [{x:((now/12)%1180)-90,y:207,w:128,h:43,color:'#b65339',dir:-1},
    {x:1090-((now/15)%1180),y:280,w:142,h:45,color:'#3475ad',dir:1}];
}
export function stepWorld(w,base,inputs,dt,now){
  const elapsed=dt*1000;dt=Math.min(dt,.075); const globallyPaused=base.presentation.active||base.pauseReasons.length>0||(!base.online&&!base.players.p0.connected);
  const active=base.presentation.active?base.presentation.roomId:null;
  if(active!==w.presentationWas){
    if(active){w.deck.room=active;w.deck.slide=GROUPS[active]?.[0]||1;if(active==='C')w.cStarted=true;if(active==='G')w.gStarted=true;for(const p of Object.values(w.players))p.request=null;}
    else if(w.presentationWas){if(w.presentationWas!=='I'||(w.reversal.phase==='complete'&&w.deck.slide===20))w.unlocked[w.presentationWas]=true;w.unlockAt=now;}
    w.presentationWas=active;
  }
  tickBridge(w,base,elapsed,globallyPaused);
  tickReversal(w,base,elapsed,globallyPaused);
  for(const p of Object.values(w.players)){
    p.connected=base.players[p.id].connected;
    if(!p.connected){
      drop(w,p.id);release(w,p.id);
      if(p.seat){const s=SCENES[p.scene].targets.find(t=>t.id===p.seat);p.seat=null;Object.assign(p,safeAnchor({x:s.x,y:s.y+38},SCENES[p.scene],solidsFor(w,p.id)));}
      p.pose='idle';continue;
    }
    const input=inputs[p.id];
    if(globallyPaused||!input||now-input.at>300||p.leader||p.seat||input.blocked){p.pose=p.seat?'seated':p.ride?'riding':'idle';continue;}
    const v=vector(input.keys),speed=p.ride?165:108;if(p.scene==='I'&&w.reversal.debuffs[p.id]>0){v.x*=-1;v.y*=-1;}
    const before={x:p.x,y:p.y};const next=move(p,v.x*speed*dt,v.y*speed*dt,SCENES[p.scene],solidsFor(w,p.id),p.ride?15:10);
    if(p.follower && distance(next,w.players[p.follower])>62){p.pose='idle';continue;}
    Object.assign(p,next);const traveled=distance(before,p);p.distance+=traveled;
    if(v.x||v.y) p.facing=Math.abs(v.x)>Math.abs(v.y)?(v.x>0?'right':'left'):(v.y>0?'down':'up');
    p.pose=p.ride?(traveled>.1?'riding':'coasting'):p.carry?'carrying':traveled>.1?'walking':'idle';
    if(p.follower&&traveled>.01){
      const follower=w.players[p.follower],d=distance(p,follower);
      if(d>31){const m=Math.min(speed*dt,d-31);Object.assign(follower,move(follower,(p.x-follower.x)/d*m,(p.y-follower.y)/d*m,SCENES[p.scene],solidsFor(w,follower.id)));follower.pose='walking';follower.facing=p.facing;follower.distance+=m;}
    }
  }
  if(!globallyPaused) for(const p of Object.values(w.players)) if(p.connected!==false&&p.scene==='street'&&now>p.resetUntil){
    if(carsAt(now).some(c=>Math.abs(p.x-c.x)<c.w/2+12&&Math.abs(p.y-c.y)<c.h/2+8)){
      p.x=460+Number(p.id[1])*30;p.y=p.y<240?155:365;p.resetUntil=now+1600;
      const pair=p.leader||p.follower;if(pair){Object.assign(w.players[pair],{x:p.x+32,y:p.y,resetUntil:p.resetUntil});}
    }
  }
}
export function act(w,base,id,command,now=Date.now()){
  const p=w.players[id],{type,payload={}}=command;
  ensure(base.players[id]?.connected,'Reconnect this view first.');
  if(type==='slide'){
    ensure(id==='p0'&&base.presentation.active&&!base.pauseReasons.length,'Presenter control is unavailable.');
    const [first,last]=GROUPS[base.presentation.roomId];
    if(base.presentation.roomId==='J'&&['next','previous','reveal','reset-view'].includes(payload.action)){
      ensure(w.cubes.pairs.every(Boolean),'Complete all three matches first.');
      if(['next','reveal'].includes(payload.action)){w.deck.finalPage='eta';w.deck.etaOrigin??=now;}
      else w.deck.finalPage='determine';
      return {kind:'ok'};
    }
    if(payload.action==='next'){ensure(base.presentation.roomId!=='I'||w.reversal.phase==='complete','Finish the floor-choice activity before slide 20.');w.deck.slide=Math.min(last,w.deck.slide+1);}
    else if(payload.action==='previous')w.deck.slide=Math.max(first,w.deck.slide-1);
    else if(payload.action==='reset-view')w.deck.slide=first;
    else if(payload.action==='reveal') {const n=w.deck.slide,cycle=n===2?3:4;ensure([2,4,5,6].includes(n),'No reveal control on this slide.');w.deck.steps[n]=w.deck.steps[n]%cycle+1;}
    else if(payload.action==='properties'){const v=payload.values||{};if(typeof v.showQuotes==='boolean')w.deck.properties.showQuotes=v.showQuotes;if(typeof v.showFolio==='boolean')w.deck.properties.showFolio=v.showFolio;if(['Black and white','Full colour'].includes(v.photoTreatment))w.deck.properties.photoTreatment=v.photoTreatment;}
    else throw Error('Unknown native slide action.');
    return {kind:'ok'};
  }
  ensure(!base.presentation.active&&!base.pauseReasons.length&&(base.online||base.players.p0.connected),'World paused. Personal notes remain available.');
  ensure(payload.instance===p.instance,'That action belongs to a previous room.');
  if(p.scene==='F')ensure(payload.generation===w.bridge.generation,'That action belongs to a previous attempt.');
  if(type==='activity'){
    if(p.scene==='I'){ensure(id==='p0'&&payload.action==='start','Presenter activity control only.');startReversal(w,base);return {kind:'ok'};}
    ensure(id==='p0'&&['F','G'].includes(p.scene),'Presenter activity control only.');
    bridgeControl(w,base,payload.action);return {kind:'ok'};
  }
  if(type==='release'){release(w,id);return {kind:'ok'};}
  if(type==='drop'){drop(w,id);return {kind:'ok'};}
  if(type==='accept'||type==='decline'){
    const leader=w.players[p.request];ensure(leader&&leader.instance===p.instance&&distance(p,leader)<=62,'Request has expired.');p.request=null;
    if(type==='accept'){ensure(!p.leader&&!p.follower&&!leader.leader&&!leader.follower&&!p.ride&&!leader.ride&&!p.carry&&!leader.carry&&!p.seat&&!leader.seat,'Let go, stand or put your object down first.');leader.follower=id;p.leader=leader.id;}
    return {kind:'ok'};
  }
  if(type==='skip'){
    ensure(id==='p0','Presenter only.');ensure(p.scene!=='F','Use Bridge Skip, then walk across.');const next={home:'street',street:'reception',reception:'A',A:'B1',B1:'C',B2:'C',B3:'C',C:'D',D:'E',E:'F',G:'I'}[p.scene];ensure(SCENES[next],'The next room is being integrated.');
    if(GROUPS[p.scene]){w.unlocked[p.scene]=true;w.unlockAt=now;}
    for(const q of Object.values(w.players))release(w,q.id);
    for(const q of Object.values(w.players))transition(w,q.id,next,now);
    return {kind:'toast',text:'Presenter Continue gathered the group at the next entrance.'};
  }
  if(type==='interact'&&p.seat){
    const seat=SCENES[p.scene].targets.find(t=>t.id===p.seat);p.seat=null;Object.assign(p,safeAnchor({x:seat.x,y:seat.y+38},SCENES[p.scene],solidsFor(w,id)));return {kind:'ok'};
  }
  if(type==='dismount'){ensure(p.ride,'You are already walking.');p.ride=null;Object.assign(p,safeAnchor(p,SCENES[p.scene],solidsFor(w,id)));return {kind:'ok'};}
  const t=targets(w,id).find(t=>t.id===payload.target);
  ensure(t&&distance(p,t)<=48,'Walk closer, then press F or click.');
  if(type==='social'){
    ensure(t.type==='person','Approach a person.');const q=w.players[t.id];
    if(payload.action==='notes')return {kind:'notes',owner:q.id};
    if(payload.action==='hi'){p.waveUntil=now+2200;return {kind:'ok'};}
    ensure(payload.action==='hold','Unknown social action.');
    ensure(!p.leader&&!p.follower&&!q.leader&&!q.follower&&!p.carry&&!q.carry&&!p.ride&&!q.ride&&!p.seat&&!q.seat,'Let go, stand or put your object down first.');
    ensure(!q.request||q.request===id,'This person has a pending invitation.');q.request=id;return {kind:'toast',text:'Invitation sent.'};
  }
  if(type==='enter'){
    ensure(t.type==='door','Use a doorway.');ensure(!t.lock||w.unlocked[t.lock],'Finish the presentation to unlock this door.');
    ensure(!(w.cStarted&&((p.scene.startsWith('B')&&t.to==='A')||(p.scene==='C'&&t.to==='route'))),'The previous section is complete.');
    ensure(!(p.scene==='G'&&t.to==='F'&&w.gStarted),'The bridge section is complete.');
    ensure(!(p.scene==='F'&&t.to==='G'&&w.bridge.phase!=='complete'),'Build the physical crossing first.');
    ensure(!p.leader,'Your partner leads. Press E to let go.');const follower=p.follower;transition(w,id,t.to,now);
    if(follower){transition(w,follower,t.to,now);Object.assign(w.players[follower],safeAnchor({x:p.x+32,y:p.y},SCENES[p.scene],solidsFor(w,follower)));}
    return {kind:'ok'};
  }
  ensure(type==='interact','Unknown world action.');
  if(t.type==='person')return p.scene==='J'&&p.carry&&w.players[t.id].carry?matchCubes(w,id,t.id,now):{kind:'person',owner:t.id};
  if(t.type==='profile')return {kind:'profile'};
  if(t.type==='notes')return {kind:'notes',owner:id};
  if(t.type==='portrait')return {kind:'portrait',index:t.index};
  if(t.type==='monitor')return {kind:'monitor',room:p.scene};
  if(t.type==='door'){
    if(t.lock&&!w.unlocked[t.lock])return {kind:'toast',text:'Locked · finish this studio presentation first.'};
    if(w.cStarted&&p.scene==='C'&&t.to==='route')return {kind:'toast',text:'The earlier reflection section is complete.'};
    return {kind:'door',target:t.id,to:t.to==='route'?p.lastRoute:t.to};
  }
  if(t.type==='plank'&&w.bridge.phase!=='attempt')return bridgeInteract(w,id,t);
  ensure(!p.leader&&!p.follower,'Press E to let go before mounting, sitting or carrying.');
  if(t.type==='cube')return claimCube(w,id,t.id);
  if(t.type==='plank'||t.type==='bridge')return bridgeInteract(w,id,t);
  if(t.type==='ride'){ensure(!p.carry,'Put down your object first.');p.ride=p.ride===t.ride?null:t.ride;p.selectedRide=t.ride;p.pose='mounting';p.mountAt=now;Object.assign(p,safeAnchor({x:t.x,y:t.y-25},SCENES[p.scene],solidsFor(w,id),p.ride?15:10));return {kind:'ok'};}
  if(t.type==='seat'){ensure(!p.carry&&!p.ride,'Put down your object and walk first.');ensure(!Object.values(w.players).some(q=>q.instance===p.instance&&q.seat===t.id),'This seat is occupied.');p.seat=t.id;p.x=t.x;p.y=t.y;p.pose='seated';return {kind:'ok'};}
  if(t.type==='shape'){ensure(!p.carry,'You can carry one shape at a time.');const o=w.routes[p.scene].find(o=>o.id===t.id);ensure(!o.owner&&!o.placed,'Someone has already picked this up.');o.owner=id;p.carry=o.id;return {kind:'ok'};}
  if(t.type==='pedestal'){
    const list=w.routes[p.scene],placed=list.find(o=>o.index===t.index&&o.placed);
    if(placed)return {kind:'reflection',route:p.scene,index:t.index};
    ensure(p.carry,'Find the matching shape on the floor.');const o=list.find(o=>o.id===p.carry);
    ensure(o.shape===t.shape,'That shape does not fit. You are still holding it.');o.placed=true;o.owner=null;o.x=t.x;o.y=t.topY;p.carry=null;
    return {kind:'reflection',route:p.scene,index:t.index};
  }
  return {kind:'ok'};
}
