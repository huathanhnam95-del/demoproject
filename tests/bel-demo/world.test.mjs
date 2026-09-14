import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../../public/prototypes/bel-working-as-equals-demo/state/session.mjs';
import {SCENES} from '../../public/prototypes/bel-working-as-equals-demo/world/scenes.mjs';
import {move,vector,valid} from '../../public/prototypes/bel-working-as-equals-demo/world/geometry.mjs';
import {createWorld,act,transition,stepWorld,monitorPresence} from '../../public/prototypes/bel-working-as-equals-demo/world/simulation.mjs';
function setup(){const b=createSession({id:'test'}).state;for(const p of Object.values(b.players))p.connected=true;return {b,w:createWorld(b)};}
function action(w,b,id,type,payload={}){return act(w,b,id,{type,payload:{instance:w.players[id].instance,...payload}},1000);}
test('only connected presenter proximity reports a monitor fact to the accepted backend',()=>{
  for(const scene of ['A','C']){assert.equal(monitorPresence({id:'p0',scene,x:631,y:183},true),true);assert.equal(monitorPresence({id:'p2',scene,x:631,y:183},true),false);assert.equal(monitorPresence({id:'p0',scene,x:631,y:183},false),false);}
});
test('feet collision: normalized diagonals, thin-wall sweep, reachable Home lower floor',()=>{
  const v=vector({w:true,a:false,s:false,d:true});assert.equal(Math.hypot(v.x,v.y),1);
  const room={floor:[{x:0,y:0,w:1000,h:500}],solids:[{x:200,y:0,w:3,h:500}]};
  const p=move({x:100,y:100},500,0,room);assert(p.x<=190);assert(valid(p,room));
  assert(valid({x:500,y:380},SCENES.home));assert(!valid({x:600,y:115},SCENES.home));
});
test('route objects are instance-scoped, single-owner, wrong matches retain carry, completed reading is individual',()=>{
  const {w,b}=setup();transition(w,'p1','B1');transition(w,'p2','B1');transition(w,'p3','B2');
  Object.assign(w.players.p1,{x:275,y:300});Object.assign(w.players.p2,{x:280,y:300});
  action(w,b,'p1','interact',{target:'shape-0'});assert.throws(()=>action(w,b,'p2','interact',{target:'shape-0'}));
  Object.assign(w.players.p1,{x:486,y:180});assert.throws(()=>action(w,b,'p1','interact',{target:'pedestal-1'}),/does not fit/);assert.equal(w.players.p1.carry,'shape-0');
  Object.assign(w.players.p1,{x:230,y:257});const read=action(w,b,'p1','interact',{target:'pedestal-0'});assert.equal(read.kind,'reflection');assert.equal(w.routes.B1[0].placed,true);assert.equal(w.routes.B2[0].placed,false);assert.equal(w.players.p2.carry,null);
  Object.assign(w.players.p2,{x:230,y:257});assert.equal(action(w,b,'p2','interact',{target:'pedestal-0'}).index,0);
});
test('door actions require proximity, unlock, matching instance and preserve active-section boundaries',()=>{
  const {w,b}=setup();transition(w,'p1','A');assert.throws(()=>action(w,b,'p1','enter',{target:'door-1'}),/closer/);
  Object.assign(w.players.p1,{x:130,y:249});assert.throws(()=>action(w,b,'p1','enter',{target:'door-1'}),/presentation/);
  w.unlocked.A=true;action(w,b,'p1','enter',{target:'door-1'});assert.equal(w.players.p1.scene,'B1');
  Object.assign(w.players.p1,{x:166,y:408});w.cStarted=true;assert.throws(()=>action(w,b,'p1','enter',{target:'back'}),/complete/);
  assert.throws(()=>act(w,b,'p1',{type:'release',payload:{instance:'A'}}),/previous room/);
});
test('accepted hand link, explicit exit, conflict rejection and linked door traversal',()=>{
  const {w,b}=setup();transition(w,'p1','A');transition(w,'p2','A');Object.assign(w.players.p1,{x:190,y:300});Object.assign(w.players.p2,{x:223,y:300});
  action(w,b,'p1','social',{target:'p2',action:'hold'});assert.equal(w.players.p1.follower,null);action(w,b,'p2','accept');assert.equal(w.players.p1.follower,'p2');
  Object.assign(w.players.p1,{x:130,y:249});Object.assign(w.players.p2,{x:161,y:249});w.unlocked.A=true;action(w,b,'p1','enter',{target:'door-1'});assert.equal(w.players.p2.scene,'B1');assert.equal(w.players.p2.leader,'p1');assert(valid(w.players.p2,SCENES.B1));
  action(w,b,'p2','release');assert.equal(w.players.p1.follower,null);
});
test('presentation pauses motion, source ranges stay distinct and participant control is rejected',()=>{
  const {w,b}=setup();transition(w,'p0','A');const p={...w.players.p0};b.presentation={active:true,roomId:'A'};
  stepWorld(w,b,{p0:{keys:{d:true},at:1000}},.05,1000);assert.equal(w.players.p0.x,p.x);
  assert.throws(()=>action(w,b,'p1','slide',{action:'next'}),/Presenter/);
  for(let i=0;i<10;i++)action(w,b,'p0','slide',{action:'next'});assert.equal(w.deck.slide,3);
  b.presentation={active:false,roomId:null};stepWorld(w,b,{},.05,1100);assert.equal(w.unlocked.A,true);assert.equal(w.unlocked.C,false);
  b.presentation={active:true,roomId:'C'};stepWorld(w,b,{},.05,1200);assert.equal(w.deck.slide,4);assert(w.cStarted);
});
test('disconnect returns a carried shape to safe floor; offline and delayed motion cannot tunnel',()=>{
  const {w,b}=setup();transition(w,'p1','B1');Object.assign(w.players.p1,{x:275,y:300});action(w,b,'p1','interact',{target:'shape-0'});
  b.players.p1.connected=false;stepWorld(w,b,{},10,1000);assert.equal(w.routes.B1[0].owner,null);assert.equal(w.players.p1.carry,null);assert(valid(w.routes.B1[0],SCENES.B1));
  b.players.p1.connected=true;const before={...w.players.p1};stepWorld(w,b,{p1:{keys:{d:true},at:0}},10,1000);assert.equal(w.players.p1.x,before.x);
});
