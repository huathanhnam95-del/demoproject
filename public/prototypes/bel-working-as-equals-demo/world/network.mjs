import {createWorld,stepWorld,act,monitorPresence} from './simulation.mjs';
import {createBridge} from '../activities/bridge.mjs';
import {createReversal} from '../activities/reversal.mjs';
import {createCubes} from '../activities/cubes.mjs';
const worldChannel=invite=>new BroadcastChannel(`bel-world:${invite.sessionId}:${invite.actorId}:${invite.token}`);
export function createWorldHost(host,storage=localStorage){
  const key=`bel-world-save:${host.state.id}`;
  const saved=storage.getItem(key),parsed=saved?JSON.parse(saved):null;
  let world=parsed?.world||parsed||createWorld(host.state);
  if(world.version!==1||world.sessionId!==host.state.id||Object.keys(world.players).join(',')!=='p0,p1,p2,p3')throw Error('World save is invalid.');
  // Additive save migration retains the exact ongoing session and notes.
  world.bridge??=createBridge();world.gStarted??=false;world.unlocked.E??=false;world.unlocked.G??=false;
  world.reversal??=createReversal();world.unlocked.I??=false;
  world.cubes??=createCubes();
  world.deck.finalPage??='determine';world.deck.etaOrigin??=null;
  const inputs={},channels={},connections={},receipts=new Map(parsed?.receipts||[]),sequences={};
  let now=Date.now(),lastSave=0,busy=false,error=null,closed=false;
  const publish=()=>{for(const [id,ch]of Object.entries(channels))if(connections[id]&&host.isActiveConnection(id,connections[id]))ch.postMessage({kind:'world',connectionId:connections[id],epoch:host.epoch,world,error});};
  const save=()=>{try{storage.setItem(key,JSON.stringify({world,receipts:[...receipts]}));error=null;}catch{error='World save unavailable. Free browser storage and reload the presenter.';throw Error(error);}};
  for(const id of ['p0','p1','p2','p3']){
    const ch=channels[id]=worldChannel(host.invite(id));
    ch.onmessage=({data:m})=>{
      if(!m||!host.isActiveConnection(id,m.connectionId))return;
      if(connections[id]!==m.connectionId){connections[id]=m.connectionId;sequences[id]=-1;delete inputs[id];}
      if(m.kind==='input'){
        if(!Number.isSafeInteger(m.seq)||m.seq<=sequences[id])return;sequences[id]=m.seq;
        const k=m.keys||{};inputs[id]={keys:{w:k.w===true,a:k.a===true,s:k.s===true,d:k.d===true},blocked:m.blocked===true,at:Date.now()};return;
      }
      if(m.kind==='hello'){publish();return;}
      if(m.kind!=='action'||typeof m.id!=='string')return;
      const receiptKey=id+'/'+m.id,serialized=JSON.stringify(m.command),prior=receipts.get(receiptKey);
      let result;
      if(prior)result=prior.serialized===serialized?prior.result:{error:'Changed action ID reuse.'};
      else{
        const before=structuredClone(world);
        try{
          result=act(world,host.state,id,m.command);world.revision++;
          receipts.set(receiptKey,{serialized,result});save();
        }catch(e){world=before;receipts.delete(receiptKey);result={error:e.message};}
        if(receipts.size>3000)receipts.delete(receipts.keys().next().value);
      }
      ch.postMessage({kind:'result',connectionId:m.connectionId,id:m.id,result});publish();
    };
  }
  const timer=setInterval(async()=>{
    if(closed||busy)return;busy=true;
    try{
      const time=Date.now(),base=host.state;
      if(!error){stepWorld(world,base,inputs,(time-now)/1000,time);world.revision++;}
      now=time;
      for(const p of Object.values(world.players)){
        const actual=host.state.players[p.id];
        const atScreen=monitorPresence(p,actual.connected,world);
        if(actual.location.sceneId!==p.scene||actual.location.atScreen!==atScreen)await host.setLocation(p.id,p.scene,atScreen);
      }
      if(time-lastSave>1000){save();lastSave=time;}publish();
    }catch(e){error=e.message;publish();}finally{busy=false;}
  },33);
  return {get snapshot(){return structuredClone(world);},close(){closed=true;clearInterval(timer);try{save();}catch{}Object.values(channels).forEach(c=>c.close());}};
}
export function createWorldClient(invite,client){
  const channel=worldChannel(invite),pending=new Map();let world=null,error=null,seq=0,last=0;
  const send=m=>channel.postMessage({...m,connectionId:client.connectionId});
  channel.onmessage=({data:m})=>{
    if(m?.connectionId!==client.connectionId)return;
    if(m.kind==='world'){
      if(!world||m.world.revision>=world.revision){world=m.world;error=m.error;last=Date.now();}
    }else if(m.kind==='result'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.result.error?p.reject(Error(m.result.error)):p.resolve(m.result);}}
  };
  const timer=setInterval(()=>{if(client.status==='online')send({kind:'hello'});for(const [id,p]of pending){if(Date.now()-p.at>10000){pending.delete(id);p.reject(Error('World action timed out. Reconnect before retrying.'));}else send(p.message);}},900);
  return {get state(){return world;},get error(){return error;},get available(){return client.status==='online'&&Date.now()-last<2500&&!error;},
    input(keys,blocked){if(client.status==='online')send({kind:'input',seq:++seq,keys,blocked});},
    action(type,payload={}){if(client.status!=='online')return Promise.reject(Error('Wait for presenter connection.'));const id=crypto.randomUUID(),message={kind:'action',id,command:{type,payload}};return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,at:Date.now(),message});send(message);});},
    close(){clearInterval(timer);channel.close();for(const p of pending.values())p.reject(Error('View closed.'));pending.clear();}};
}
