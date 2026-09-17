// Session-authoritative 60 / 30 / 10 second bridge loop. Rendering never owns time.
export const PLANKS=[
  ['teal','diamond','Prepare your questions',650,351],
  ['violet','two bars','Discuss your opinions and approaches',210,337],
  ['rose','star','Review discussions',363,361],
  ['red','circle','Define action plan',319,286],
  ['blue','cross','Update on progress + Q&A',795,361],
  ['amber','triangle','Revise action plan',682,274]
];
export const PHASES=['Preparation','Action','Review & revision'];
export const plankPosition=index=>({x:500,y:233-index*16});
export function createBridge(generation=0){return {generation,phase:'gathering',remaining:60000,attempt:0,placed:0,assisted:false,lastPlaced:0,
  planks:PLANKS.map(([color,mark,text,x,y],index)=>({id:`plank-${index}`,index,color,mark,text,x,y,owner:null,placed:false}))};}
export const bridgeReady=(w,b)=>{
  const players=Object.values(b.players);
  const connected=players.filter(p=>p.connected);
  if(connected.length===1&&connected[0].id==='p0'){
    return Boolean(connected[0].ready&&w.players.p0.scene==='F');
  }
  return players.every(p=>p.connected&&p.ready&&w.players[p.id].scene==='F');
};
export function resetBridge(w,b,{review=false}={}){
  const old=w.bridge,next=createBridge(old.generation+1);next.attempt=old.attempt;next.lastPlaced=old.placed;
  const inBridgeScene=p=>['F','G'].includes(w.players[p.id].scene);
  const players=Object.values(b.players);
  const connected=players.filter(p=>p.connected);
  const prepReady=connected.length===1&&connected[0].id==='p0'
    ?Boolean(connected[0].ready&&inBridgeScene(connected[0]))
    :players.every(p=>p.connected&&p.ready&&inBridgeScene(p));
  next.phase=review?'review':prepReady?'preparation':'gathering';next.remaining=review?10000:60000;
  w.bridge=next;
  for(const p of Object.values(w.players))if(['F','G'].includes(p.scene)){
    p.scene='F';p.instance='F';p.x=350+Number(p.id[1])*68;p.y=375;p.carry=null;p.seat=null;p.pose='idle';p.inspect=null;
  }
  // Keep accepted pairs adjacent and clear of all other entry anchors.
  for(const p of Object.values(w.players))if(p.scene==='F'&&p.follower){const q=w.players[p.follower];q.x=p.x+32;q.y=p.y-30;}
}
export function tickBridge(w,b,elapsed,paused){
  const f=w.bridge;if(paused||!bridgeReady(w,b)||!['preparation','attempt','review'].includes(f.phase))return;
  f.remaining=Math.max(0,f.remaining-elapsed);
  if(f.remaining>0)return;
  if(f.phase==='attempt'){resetBridge(w,b,{review:true});return;}
  f.phase='attempt';f.remaining=30000;f.attempt++;for(const p of Object.values(w.players))p.inspect=null;
}
export function bridgeControl(w,b,action){
  if(w.gStarted)throw Error('The bridge section is complete.');
  if(action==='reset'){resetBridge(w,b);return;}
  const f=w.bridge;
  if(action==='start'){
    if(!bridgeReady(w,b))throw Error('Wait for all three participants in F.');
    if(f.phase!=='gathering')throw Error('Preparation has already started.');
    f.phase='preparation';f.remaining=60000;return;
  }
  if(action!=='skip'||!['preparation','attempt','review'].includes(f.phase))throw Error('Skip is available during preparation, an attempt or review.');
  f.phase='complete';f.assisted=true;f.remaining=0;f.generation++;f.placed=6;
  f.planks.forEach(o=>Object.assign(o,plankPosition(o.index),{owner:null,placed:true}));
  for(const p of Object.values(w.players))if(p.scene==='F'){p.carry=null;p.inspect=null;}
}
export function bridgeInteract(w,id,target){
  const p=w.players[id],f=w.bridge;
  if(target.type==='plank'){
    const o=f.planks.find(o=>o.id===target.id);
    if(f.phase!=='attempt'){p.inspect=o.id;return {kind:'ok'};}
    if(p.carry)throw Error('You can carry one plank at a time.');
    if(o.owner||o.placed)throw Error('This plank has already been claimed.');
    o.owner=id;p.carry=o.id;p.inspect=o.id;return {kind:'ok'};
  }
  if(f.phase!=='attempt')throw Error('Carrying begins with the team attempt.');
  const o=f.planks.find(o=>o.id===p.carry);
  if(!o)throw Error('Bring a plank to the next open position.');
  if(o.index!==f.placed)throw Error('That thought comes elsewhere. You still hold the plank.');
  Object.assign(o,plankPosition(o.index),{owner:null,placed:true});p.carry=null;p.inspect=null;f.placed++;
  if(f.placed===6){f.phase='complete';f.remaining=0;}
  return {kind:'ok'};
}
