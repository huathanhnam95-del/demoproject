import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scopeDeck } from '../../public/js/presentation-demo/presentation/frame.mjs';
import { GROUPS } from '../../public/js/presentation-demo/core/content/source.mjs';
const require = createRequire(import.meta.url);
const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { AuthoritativeRuntime } = require('../../functions/src/crm/presentation-demo/runtime.cjs');

function studio(scene = 'A') {
  let now = 1000;
  const runtime = new AuthoritativeRuntime(createRoomState({ roomId:'gameplay-ux', code:'ABCD23', presenterUid:'admin', now }), { clock:()=>now });
  for (const [i, slot] of Object.values(runtime.room.slots).entries()) {
    slot.uid = i ? `person-${i}` : 'admin'; runtime.connect(slot.slotId); runtime.markBootstrap(slot.slotId);
    slot.activity.ready = true;
    Object.assign(runtime.room.gameplay.players[slot.slotId], { scene, instance:scene, x:630, y:175+i*30 });
    Object.assign(slot, { scene, instanceId:scene });
  }
  runtime.room.lifecycle = 'playing';
  const command = (id, value) => runtime.command(id, 1, { ...value, seq:(value.type==='move'?runtime.room.lastInputSeq[id]:runtime.room.lastCommandSeq[id])+1 }, now);
  return { runtime, command, advance(ms) { now+=ms; runtime.tick(now); } };
}

test('presenter can stop at the first slide; all players resume without unlocking unfinished content', () => {
  const f=studio();
  f.command('p0',{type:'presentation',action:'open'});
  assert.equal(f.runtime.room.deck.slide,1);
  assert.throws(()=>f.command('p1',{type:'presentation',action:'close'}),{code:'PRESENTER_ONLY'});
  f.command('p0',{type:'presentation',action:'close'});
  assert.equal(f.runtime.room.gameplay.presentation.active,false);
  assert.equal(f.runtime.room.gameplay.unlocked.A,false);
  const x=f.runtime.room.gameplay.players.p1.x;
  f.command('p1',{type:'move',dx:1,dy:0}); f.advance(100);
  assert.ok(f.runtime.room.gameplay.players.p1.x>x);
  f.command('p0',{type:'presentation',action:'open'});
  for(let i=0;i<5;i++)f.command('p0',{type:'world',action:'slide',payload:{action:'next'}});
  assert.equal(f.runtime.room.deck.slide,3);
  f.command('p0',{type:'presentation',action:'close'});
  assert.equal(f.runtime.room.gameplay.unlocked.A,true);
});

test('local visual movement progresses between snapshots, stays on floor and reconciles transitions', async () => {
  const { LocalMovement }=await import('../../public/js/presentation-demo/movement.mjs');
  const f=studio(), world=f.runtime.room.gameplay;
  const p=world.players.p0; Object.assign(p,{scene:'home',instance:'home:p0',x:302,y:308});
  const view=new LocalMovement();
  let last=view.sample(world,'p0',{},0,false), moving=0;
  for(let t=16;t<=240;t+=16){
    const v=view.sample(world,'p0',{d:true},t,false);
    if(v.x>last.x) moving++;
    assert.ok(v.x-last.x<5,'no visible snapshot-sized jump'); last=v;
  }
  assert.equal(moving,15,'no 120 ms extrapolation freeze');
  assert.equal(p.x,302,'render prediction cannot mutate authoritative state');
  assert.equal(last.pose,'walking');
  Object.assign(p,{x:839,y:150}); world.tickAt=2000;
  for(let t=256;t<480;t+=16)last=view.sample(world,'p0',{d:true},t,false);
  assert.ok(last.x<=840,'same feet radius and floor collision as server');
  Object.assign(p,{scene:'A',instance:'A',x:630,y:175});
  last=view.sample(world,'p0',{},500,false); assert.equal(last.x,p.x);assert.equal(last.y,p.y);
  world.presentation.active=true;
  assert.equal(view.sample(world,'p0',{d:true},516,true).x,p.x);
});

test('every studio exposes only its assigned native slide nodes and resets exclusions on room change', () => {
  const nodes=Array.from({length:21},()=>({tagName:'SECTION',attributes:new Map(),
    toggleAttribute(key,on){if(on)this.attributes.set(key,'');else this.attributes.delete(key);},
    setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);}}));
  const stage={children:nodes};
  for(const [room,[first,last]] of Object.entries(GROUPS)){
    assert.deepEqual(scopeDeck(stage,room),[first,last]);
    assert.deepEqual(nodes.flatMap((n,i)=>n.attributes.has('data-room-excluded')?[]:[i+1]),Array.from({length:last-first+1},(_,i)=>first+i));
    assert.equal(nodes.filter(n=>!n.inert).length,last-first+1);
    assert.equal(stage.children,nodes,'preserve mounted authored components');
  }
  scopeDeck(stage,null);assert.ok(nodes.every(n=>n.inert));
});

test('stop clears stale inputs and pause while retaining the floor activity gate', () => {
  const f=studio('I');
  f.command('p0',{type:'presentation',action:'open'});
  f.command('p0',{type:'presentation',action:'pause'});
  f.command('p1',{type:'move',dx:1,dy:0});
  f.command('p0',{type:'presentation',action:'close'});
  assert.equal(f.runtime.room.gameplay.paused,false);
  assert.deepEqual(f.runtime.room.gameplay.inputs,{});
  assert.equal(f.runtime.room.gameplay.unlocked.I,false);
});
