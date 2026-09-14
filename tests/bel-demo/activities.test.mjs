import {test} from 'node:test';import assert from 'node:assert/strict';
import {createSession} from '../../public/prototypes/bel-working-as-equals-demo/state/session.mjs';
import {createWorld,transition,act,stepWorld,solidsFor,monitorPresence} from '../../public/prototypes/bel-working-as-equals-demo/world/simulation.mjs';
import {etaRemaining,ETA_INITIAL} from '../../public/prototypes/bel-working-as-equals-demo/presentation/final.mjs';
import {SCENES} from '../../public/prototypes/bel-working-as-equals-demo/world/scenes.mjs';
import {move,valid} from '../../public/prototypes/bel-working-as-equals-demo/world/geometry.mjs';
import {plankPosition} from '../../public/prototypes/bel-working-as-equals-demo/activities/bridge.mjs';
import {choiceAt} from '../../public/prototypes/bel-working-as-equals-demo/activities/reversal.mjs';
function setup(){const b=createSession({id:'activities'}).state;for(const p of Object.values(b.players)){p.connected=true;p.ready=true;}const w=createWorld(b);for(const id of Object.keys(w.players))transition(w,id,'F');return {w,b};}
function action(w,b,id,type,payload={}){return act(w,b,id,{type,payload:{instance:w.players[id].instance,generation:w.bridge.generation,...payload}});}
function start(w,b){action(w,b,'p0','activity',{action:'start'});stepWorld(w,b,{},60,100000);assert.equal(w.bridge.phase,'attempt');}
test('bridge preparation, missing roster pause, deadline reset, ten-second review and retry use one clock',()=>{
 const {w,b}=setup();action(w,b,'p0','activity',{action:'start'});stepWorld(w,b,{},20,20000);assert.equal(w.bridge.remaining,40000);
 b.players.p3.connected=false;stepWorld(w,b,{},100,120000);assert.equal(w.bridge.remaining,40000);b.players.p3.connected=true;
 b.pauseReasons=['manual'];stepWorld(w,b,{},20,140000);assert.equal(w.bridge.remaining,40000);b.pauseReasons=[];
 stepWorld(w,b,{},40,180000);assert.equal(w.bridge.phase,'attempt');assert.equal(w.bridge.remaining,30000);
 stepWorld(w,b,{},30,210000);assert.equal(w.bridge.phase,'review');assert.equal(w.bridge.remaining,10000);assert.equal(w.bridge.generation,1);
 stepWorld(w,b,{},10,220000);assert.equal(w.bridge.phase,'attempt');assert.equal(w.bridge.attempt,2);
});
test('six sequential bridge claims: private inspect, no carry in preparation, wrong order retained, no duplicate owner',()=>{
 const {w,b}=setup();const p=w.players.p1,o=w.bridge.planks[1];Object.assign(p,{x:o.x,y:o.y-21});action(w,b,'p1','interact',{target:o.id});assert.equal(p.carry,null);assert.equal(p.inspect,o.id);
 start(w,b);action(w,b,'p1','interact',{target:o.id});Object.assign(w.players.p2,{x:o.x+23,y:o.y-21});assert.throws(()=>action(w,b,'p2','interact',{target:o.id}));
 Object.assign(p,{x:500,y:260});assert.throws(()=>action(w,b,'p1','interact',{target:'bridge-next'}),/elsewhere/);assert.equal(p.carry,o.id);action(w,b,'p1','drop');
 for(let i=0;i<6;i++){const plank=w.bridge.planks[i];Object.assign(p,{x:plank.x,y:plank.y+21});action(w,b,'p1','interact',{target:plank.id});const dest=plankPosition(i);Object.assign(p,{x:dest.x,y:dest.y+26});action(w,b,'p1','interact',{target:'bridge-next'});assert.equal(w.bridge.placed,i+1);}
 assert.equal(w.bridge.phase,'complete');assert.equal(w.bridge.remaining,0);assert.equal(w.bridge.assisted,false);
});
test('missing bridge is physical: remote door and movement fail, partial crossing extends with installed planks',()=>{
 const {w,b}=setup(),p=w.players.p1;Object.assign(p,{x:500,y:265});assert.throws(()=>action(w,b,'p1','enter',{target:'onward'}),/closer/);
 let end=move(p,0,-150,SCENES.F,solidsFor(w,'p1',true));assert(end.y>=250);
 w.bridge.placed=2;end=move(p,0,-150,SCENES.F,solidsFor(w,'p1',true));assert(end.y<230&&end.y>=218);
 w.bridge.placed=6;end=move(p,0,-135,SCENES.F,solidsFor(w,'p1',true));assert(end.y<155);
});
test('bridge Skip assembles without teleporting, Reset recovers a player in G, preserves pairs and rejects stale attempts',()=>{
 const {w,b}=setup();start(w,b);const before={...w.players.p1};action(w,b,'p0','activity',{action:'skip'});assert.equal(w.bridge.placed,6);assert.equal(w.bridge.assisted,true);assert.equal(w.players.p1.x,before.x);
 transition(w,'p2','G');w.players.p1.follower='p3';w.players.p3.leader='p1';const gen=w.bridge.generation;
 action(w,b,'p0','activity',{action:'reset'});assert.equal(w.players.p2.scene,'F');assert.equal(w.bridge.phase,'preparation');assert.equal(w.bridge.remaining,60000);assert.equal(w.players.p3.leader,'p1');
 for(const p of Object.values(w.players))assert(valid(p,SCENES.F,solidsFor(w,p.id)),p.id);
 assert.throws(()=>action(w,b,'p1','interact',{target:'plank-0',generation:gen}),/previous attempt/);
 w.gStarted=true;assert.throws(()=>action(w,b,'p0','activity',{action:'reset'}),/complete/);
});
test('disconnected bridge carrier drops safely without consuming attempt time',()=>{
 const {w,b}=setup();start(w,b);const o=w.bridge.planks[0];Object.assign(w.players.p1,{x:o.x,y:o.y+21});action(w,b,'p1','interact',{target:o.id});b.players.p1.connected=false;stepWorld(w,b,{},12,130000);assert.equal(o.owner,null);assert.equal(w.bridge.remaining,30000);assert.equal(w.players.p1.carry,null);assert(valid(o,SCENES.F,solidsFor(w,'p1')));
});
function inChoices(){const s=setup();for(const id of Object.keys(s.w.players))transition(s.w,id,'I');return s;}
test('floor choice samples feet exactly once after the complete sentence and reverses movement for wrong and no choice',()=>{
 const {w,b}=inChoices();Object.assign(w.players.p1,{x:500,y:300});Object.assign(w.players.p2,{x:200,y:250});Object.assign(w.players.p3,{x:800,y:250});
 action(w,b,'p0','activity',{action:'start'});stepWorld(w,b,{},3,3000);assert.equal(w.reversal.phase,'choice');assert.equal(w.reversal.results.length,0);stepWorld(w,b,{},5,8000);
 const result=w.reversal.results[0];assert.equal(result.players.p1.choice,null);assert.equal(result.players.p2.correct,true);assert.equal(result.players.p3.correct,false);assert.equal(w.reversal.debuffs.p1,20000);assert.equal(w.reversal.debuffs.p2,0);
 const x=w.players.p1.x;stepWorld(w,b,{p1:{keys:{w:false,a:false,s:false,d:true},at:8050}},.05,8050);assert(w.players.p1.x<x);assert.equal(result.players.p1.choice,null);
 Object.assign(w.players.p2,{x:800,y:250});assert.equal(result.players.p2.choice,'Do');
});
test('reversal is not refreshed or stacked; participant loss, presenter pause and native recap preserve the clocks',()=>{
 const {w,b}=inChoices();action(w,b,'p0','activity',{action:'start'});stepWorld(w,b,{},3,3000);stepWorld(w,b,{},5,8000);assert.equal(w.reversal.debuffs.p1,20000);
 b.players.p3.connected=false;stepWorld(w,b,{},10,18000);assert.equal(w.reversal.debuffs.p1,20000);assert.equal(w.reversal.remaining,10000);b.players.p3.connected=true;
 b.pauseReasons=['manual'];stepWorld(w,b,{},10,28000);assert.equal(w.reversal.remaining,10000);b.pauseReasons=[];
 b.presentation={active:true,roomId:'I'};stepWorld(w,b,{},10,38000);assert.equal(w.reversal.remaining,10000);assert.throws(()=>action(w,b,'p0','slide',{action:'next'}),/before slide 20/);
 b.presentation={active:false,roomId:null};stepWorld(w,b,{},0,38000);assert.equal(w.unlocked.I,false);
 stepWorld(w,b,{},10,48000);stepWorld(w,b,{},3,51000);stepWorld(w,b,{},5,56000);assert.equal(w.reversal.debuffs.p1,2000);stepWorld(w,b,{},2,58000);assert.equal(w.reversal.debuffs.p1,0);
 Object.assign(w.players.p1,{x:500,y:300});const x=w.players.p1.x;stepWorld(w,b,{p1:{keys:{w:false,a:false,s:false,d:true},at:58050}},.05,58050);assert(w.players.p1.x>x);
});
test('six floor decisions finish without position resets, points or a final interval; follower choice remains independent',()=>{
 const {w,b}=inChoices();Object.assign(w.players.p1,{x:220,y:250,leader:'p2'});assert.equal(choiceAt(w.players.p1),null);w.players.p1.leader=null;const pos={x:w.players.p1.x,y:w.players.p1.y};
 action(w,b,'p0','activity',{action:'start'});
 for(let i=0;i<25&&w.reversal.phase!=='complete';i++)stepWorld(w,b,{},w.reversal.remaining/1000,100000+i*10000);
 assert.equal(w.reversal.phase,'complete');assert.equal(w.reversal.results.length,6);assert.equal(w.reversal.remaining,0);assert.equal(w.reversal.debuffs.p1,0);assert.equal(w.players.p1.x,pos.x);assert.equal(w.players.p1.y,pos.y);
 b.presentation={active:true,roomId:'I'};stepWorld(w,b,{},0,200000);action(w,b,'p0','slide',{action:'next'});assert.equal(w.deck.slide,20);b.presentation={active:false,roomId:null};stepWorld(w,b,{},0,200001);assert.equal(w.unlocked.I,true);
});
test('J requires two real carriers, retains mismatches, claims exactly once, and exposes completed objectives in any order',()=>{
 const {w,b}=setup();for(const id of Object.keys(w.players))transition(w,id,'J');Object.assign(w.players.p0,{x:729,y:177});assert.equal(monitorPresence(w.players.p0,true,w),false);
 const grab=(id,i)=>{const o=w.cubes.cubes[i];Object.assign(w.players[id],{x:o.x,y:o.y-24});action(w,b,id,'interact',{target:o.id});};
 grab('p1',0);Object.assign(w.players.p3,{x:430,y:190});assert.throws(()=>action(w,b,'p3','interact',{target:'cube-0'}));grab('p2',1);
 Object.assign(w.players.p1,{x:300,y:300});Object.assign(w.players.p2,{x:331,y:300});assert.equal(action(w,b,'p1','interact',{target:'p2'}).kind,'toast');assert.equal(w.players.p1.carry,'cube-0');assert.equal(w.players.p2.carry,'cube-1');assert(!w.cubes.pairs.some(Boolean));
 action(w,b,'p2','drop');grab('p2',4);Object.assign(w.players.p2,{x:331,y:300});action(w,b,'p1','interact',{target:'p2'});assert.deepEqual(w.cubes.pairs,[false,false,true]);assert.equal(w.players.p1.carry,null);assert.equal(w.players.p2.carry,null);
 for(const [i,j]of [[2,5],[1,3]]){grab('p1',i);grab('p2',j);Object.assign(w.players.p1,{x:300,y:300});Object.assign(w.players.p2,{x:331,y:300});action(w,b,'p2','interact',{target:'p1'});}
 assert(w.cubes.pairs.every(Boolean));assert.equal(monitorPresence(w.players.p0,true,w),true);assert.equal(w.cubes.cubes.filter(o=>o.placed).length,6);
 assert.throws(()=>action(w,b,'p1','interact',{target:'p1'}),/closer/);
});
test('J disconnect preserves a recoverable cube and final navigation reuses one native ETA origin',()=>{
 const {w,b}=setup();for(const id of Object.keys(w.players))transition(w,id,'J');Object.assign(w.players.p1,{x:430,y:190});action(w,b,'p1','interact',{target:'cube-0'});b.players.p1.connected=false;stepWorld(w,b,{},.05,1000);assert.equal(w.cubes.cubes[0].owner,null);assert(valid(w.cubes.cubes[0],SCENES.J,solidsFor(w,'p1')));b.players.p1.connected=true;
 b.presentation={active:true,roomId:'J'};stepWorld(w,b,{},0,2000);assert.equal(w.deck.finalPage,'determine');assert.throws(()=>action(w,b,'p0','slide',{action:'next'}),/three matches/);
 w.cubes.pairs=[true,true,true];action(w,b,'p0','slide',{action:'reveal'});const origin=w.deck.etaOrigin;assert.equal(w.deck.finalPage,'eta');action(w,b,'p0','slide',{action:'previous'});assert.equal(w.deck.finalPage,'determine');action(w,b,'p0','slide',{action:'next'});assert.equal(w.deck.etaOrigin,origin);action(w,b,'p0','slide',{action:'reset-view'});assert.equal(w.deck.etaOrigin,origin);assert.equal(w.deck.finalPage,'determine');assert.throws(()=>action(w,b,'p1','slide',{action:'next'}),/Presenter/);
 assert.equal(etaRemaining(1000,1000),ETA_INITIAL);assert.equal(etaRemaining(1000,3999),ETA_INITIAL);assert.equal(etaRemaining(1000,4000),ETA_INITIAL-1000);assert.equal(etaRemaining(1000,8000),ETA_INITIAL-5000);
});
