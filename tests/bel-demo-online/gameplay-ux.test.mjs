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

test('releasing movement keys stops cleanly without backward sliding or reversing', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 300, y: 300 });
  const view = new LocalMovement();
  let last = view.sample(world, 'p0', {}, 0, false);
  for (let t = 16; t <= 200; t += 16) {
    last = view.sample(world, 'p0', { d: true }, t, false);
  }
  const stopX = last.x;
  assert.ok(stopX > 300, 'player advanced while keys were held');
  assert.equal(last.pose, 'walking');

  // Key release at t=216: no keys active, server position still lags behind local visual position
  for (let t = 216; t <= 400; t += 16) {
    const v = view.sample(world, 'p0', {}, t, false);
    assert.ok(v.x >= stopX - 0.001, `must not slide backward toward lagging server snapshot: v.x (${v.x}) >= stopX (${stopX})`);
    assert.equal(v.pose, 'idle', 'pose becomes idle immediately when stopped');
    last = v;
  }
});

test('installInput maps Arrow keys to WASD directions and triggers onChange callback immediately', async () => {
  const { installInput } = await import('../../public/prototypes/bel-working-as-equals-demo/world/input.mjs');
  const listeners = {};
  const fakeWindow = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); }
  };
  const fakeDoc = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); }
  };
  const fakeCanvas = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    focus: () => {}
  };

  const origWindow = globalThis.window;
  const origDoc = globalThis.document;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDoc;

  try {
    const changes = [];
    const input = installInput(fakeCanvas, {
      blocked: () => false,
      escape: () => {},
      release: () => {},
      interact: () => {},
      onChange: keys => changes.push({ ...keys })
    });

    const fireKey = (type, key) => {
      for (const fn of listeners[type] || []) {
        fn({ key, preventDefault: () => {} });
      }
    };

    // Test ArrowRight -> d
    fireKey('keydown', 'ArrowRight');
    assert.equal(input.keys.d, true);
    assert.equal(changes.at(-1)?.d, true);

    // Test ArrowUp -> w
    fireKey('keydown', 'ArrowUp');
    assert.equal(input.keys.w, true);
    assert.equal(changes.at(-1)?.w, true);

    // Keyup ArrowRight
    fireKey('keyup', 'ArrowRight');
    assert.equal(input.keys.d, false);
    assert.equal(changes.at(-1)?.d, false);

    // Keyup ArrowUp
    fireKey('keyup', 'ArrowUp');
    assert.equal(input.keys.w, false);
    assert.equal(changes.at(-1)?.w, false);

    // Test ArrowLeft -> a and ArrowDown -> s
    fireKey('keydown', 'ArrowLeft');
    fireKey('keydown', 'ArrowDown');
    assert.equal(input.keys.a, true);
    assert.equal(input.keys.s, true);

    // Blur clears all keys
    for (const fn of listeners.blur || []) fn();
    assert.equal(input.keys.a, false);
    assert.equal(input.keys.s, false);
    assert.equal(changes.at(-1)?.a, false);

    // Multi-key overlap: holding both WASD and Arrow key for same direction
    fireKey('keydown', 'w');
    fireKey('keydown', 'ArrowUp');
    assert.equal(input.keys.w, true);
    // Releasing 'w' while 'ArrowUp' is still held must keep w active
    fireKey('keyup', 'w');
    assert.equal(input.keys.w, true, 'w must remain true when ArrowUp is still held');
    // Releasing 'ArrowUp' clears w
    fireKey('keyup', 'ArrowUp');
    assert.equal(input.keys.w, false);

    // Diagonal key combination: ArrowUp + d, then release ArrowUp
    fireKey('keydown', 'ArrowUp');
    fireKey('keydown', 'd');
    assert.equal(input.keys.w, true);
    assert.equal(input.keys.d, true);
    fireKey('keyup', 'ArrowUp');
    assert.equal(input.keys.w, false);
    assert.equal(input.keys.d, true, 'd must remain active after releasing ArrowUp');
    fireKey('keyup', 'd');
    assert.equal(input.keys.d, false);

    input.close();
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDoc;
  }
});

test('diagonal movement faces direction of horizontal travel and avoids reverse moonwalking', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 302, y: 308, facing: 'right' });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 100, false);

  // Moving up-left (w + a): should face left, not up/right
  const upLeft = view.sample(world, 'p0', { w: true, a: true }, 116, false);
  assert.equal(upLeft.facing, 'left', 'up-left movement must face left');
  assert.equal(upLeft.facingDir, -1);

  // Moving down-left (s + a): should face left, not down/right
  const downLeft = view.sample(world, 'p0', { s: true, a: true }, 132, false);
  assert.equal(downLeft.facing, 'left', 'down-left movement must face left');
  assert.equal(downLeft.facingDir, -1);

  // Moving purely up (w): retains previous horizontal orientation (-1 / left)
  const up = view.sample(world, 'p0', { w: true }, 148, false);
  assert.equal(up.facing, 'up');
  assert.equal(up.facingDir, -1, 'pure vertical movement preserves previous facingDir');

  // Moving down-right (s + d): faces right
  const downRight = view.sample(world, 'p0', { s: true, d: true }, 164, false);
  assert.equal(downRight.facing, 'right');
  assert.equal(downRight.facingDir, 1);
});

test('LocalMovement holds firm during stopping grace period then smoothly converges onto server position', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 302, y: 308 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);
  for (let t = 16; t <= 200; t += 16) view.sample(world, 'p0', { d: true }, t, false);
  const stopped = view.sample(world, 'p0', {}, 216, false);
  const stopX = stopped.x;

  // During 250ms stopping grace window (t=216 to t=450), position holds rock-solid without pulling backward
  for (let t = 232; t <= 450; t += 16) {
    const v = view.sample(world, 'p0', {}, t, false);
    assert.equal(v.x, stopX, 'must hold firm at stop position during grace window');
  }

  // Authoritative server settles slightly behind client (e.g. 320 vs 322.7)
  p.x = 320;
  world.tickAt = 500;
  // After grace window, idle drift converges smoothly towards settled server position
  for (let t = 500; t <= 1000; t += 16) {
    world.tickAt = t;
    view.sample(world, 'p0', {}, t, false);
  }
  const settled = view.sample(world, 'p0', {}, 1016, false);
  assert.ok(Math.abs(settled.x - p.x) < 0.1, `must converge to server position: visual ${settled.x}, server ${p.x}`);
});

test('LocalMovement maintains continuous forward velocity and avoids rubber-banding when lagging server snapshots arrive', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 300, y: 300 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);

  let prevX = 300;
  for (let t = 16; t <= 320; t += 16) {
    if (t % 48 === 0) {
      // Authoritative server snapshot arrives lagging behind client by 20px
      p.x = Math.max(300, prevX - 20);
      world.tickAt = t;
    }
    const current = view.sample(world, 'p0', { d: true }, t, false);
    assert.ok(current.x > prevX, `must advance strictly forward every frame without backward jerks: t=${t} current.x=${current.x} prevX=${prevX}`);
    assert.equal(current.pose, 'walking');
    prevX = current.x;
  }
});

test('installInput safely handles undefined key events, zero-dimension canvas bounds, and clear consistency', async () => {
  const { installInput } = await import('../../public/prototypes/bel-working-as-equals-demo/world/input.mjs');
  const listeners = {};
  const fakeTarget = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    focus: () => {}
  };
  const origWindow = globalThis.window, origDoc = globalThis.document;
  globalThis.window = fakeTarget;
  globalThis.document = fakeTarget;

  try {
    let interacted = null;
    const input = installInput(fakeTarget, {
      blocked: () => false,
      escape: () => {},
      release: () => {},
      interact: pt => { interacted = pt; },
      onChange: () => {}
    });

    const fire = (type, evt) => {
      for (const fn of listeners[type] || []) fn(evt);
    };

    // Synthetic key event with missing key property must not throw
    assert.doesNotThrow(() => fire('keydown', { preventDefault: () => {} }));
    assert.doesNotThrow(() => fire('keyup', { preventDefault: () => {} }));

    // Click on canvas with zero width/height must not produce NaN
    fire('click', { clientX: 50, clientY: 50 });
    assert.ok(Number.isFinite(interacted?.x));
    assert.ok(Number.isFinite(interacted?.y));

    // Clear must reset all key fields
    input.keys.w = true;
    input.clear();
    assert.equal(input.keys.w, false);

    input.close();
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDoc;
  }
});

test('sprites avatar gracefully handles missing distance and zero facingDir', async () => {
  const { avatar } = await import('../../public/prototypes/bel-working-as-equals-demo/world/sprites.mjs');
  const calls = [];
  const fakeCtx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x, y) => calls.push(['translate', x, y]),
    scale: (x, y) => calls.push(['scale', x, y]),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    fillRect: () => {}, fill: () => {}, stroke: () => {}, strokeRect: () => {},
    beginPath: () => {}, ellipse: () => {},
    measureText: () => ({ width: 20 }), fillText: () => {}
  };

  // Avatar with undefined distance and facingDir: 0 must not produce NaN or scale to 0 width
  avatar(fakeCtx, { x: 300, y: 300, pose: 'walking', facing: 'left', facingDir: 0 }, { name: 'Taylor', gender: 'female', appearance: { shirt: 'teal' }, id: 'p1' }, 1000, false, null);
  const scaleCall = calls.find(c => Array.isArray(c) && c[0] === 'scale');
  assert.ok(scaleCall, 'scale transform must be invoked');
  assert.notEqual(scaleCall[1], 0, 'scale X must never be zero');
  assert.equal(scaleCall[1], -1.35, 'scale X must face left when facing left with zero facingDir');
});

test('LocalMovement eases continuously without 230ms freeze when stopped with drift exceeding 45px', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 302, y: 308 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);
  for (let t = 16; t <= 200; t += 16) {
    p.x = 302 + (t / 1000) * 108;
    world.tickAt = t;
    view.sample(world, 'p0', { d: true }, t, false);
  }
  // Server position collided 50px behind visual position
  p.x = 270;
  world.tickAt = 216;
  const atStop = view.sample(world, 'p0', {}, 216, false);
  const stopX = atStop.x;

  // Frame at t=232 (stopAge 16ms < 250ms, but initial drift was > 45px)
  world.tickAt = 232;
  const frame1 = view.sample(world, 'p0', {}, 232, false);
  assert.ok(frame1.x < stopX, 'must begin easing toward server immediately instead of freezing');

  // Frame at t=248 (stopAge 32ms < 250ms)
  world.tickAt = 248;
  const frame2 = view.sample(world, 'p0', {}, 248, false);
  assert.ok(frame2.x < frame1.x, 'must continue easing smoothly without freezing when drift enters <= 45 range');

  // Continues easing to server position (from a 53px delta, exponential decay tau=0.15s decays below 0.05px in ~1.1s)
  for (let t = 264; t <= 1300; t += 16) {
    world.tickAt = t;
    view.sample(world, 'p0', {}, t, false);
  }
  const settled = view.sample(world, 'p0', {}, 1316, false);
  assert.ok(Math.abs(settled.x - p.x) < 0.1, `must converge cleanly: settled ${settled.x}, server ${p.x}`);
});

test('LocalMovement directly supports raw Arrow key objects with extended snapshot age tolerance', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 302, y: 308 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);

  // Raw ArrowUp key
  const v1 = view.sample(world, 'p0', { ArrowUp: true }, 16, false);
  assert.ok(v1.y < 308, 'ArrowUp moves upward');
  assert.equal(v1.facing, 'up');

  // Raw arrowleft key
  const v2 = view.sample(world, 'p0', { arrowleft: true }, 32, false);
  assert.ok(v2.x < 302, 'arrowleft moves left');
  assert.equal(v2.facing, 'left');
  assert.equal(v2.facingDir, -1);

  // Age tolerance: 800ms snapshot age with active arrow key does NOT reset to server position (maxAge 1500ms)
  world.tickAt = 0;
  const v3 = view.sample(world, 'p0', { arrowright: true }, 800, false);
  assert.ok(v3.x > 300, 'snapshot age of 800ms does not snap when arrow keys are active');
});

test('LocalMovement immediately snaps when player scene changes', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'shared-instance', x: 302, y: 308 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);
  for (let t = 16; t <= 100; t += 16) view.sample(world, 'p0', { d: true }, t, false);

  // Player teleports/transitions to reception scene with same instance string
  Object.assign(p, { scene: 'reception', instance: 'shared-instance', x: 500, y: 368 });
  const transitioned = view.sample(world, 'p0', {}, 116, false);
  assert.equal(transitioned.scene, 'reception');
  assert.equal(transitioned.x, 500, 'must snap immediately to new scene coordinates');
  assert.equal(transitioned.y, 368);
});

test('LocalMovement preserves along-track lead and eliminates rubber-banding on 90-degree corner turns', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 300, y: 300, facing: 'right', facingDir: 1 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);
  // Advance along X for 200ms
  for (let t = 16; t <= 200; t += 16) view.sample(world, 'p0', { d: true }, t, false);
  const beforeTurn = view.sample(world, 'p0', { d: true }, 200, false);
  assert.ok(beforeTurn.x > 320, 'visual position advanced forward');

  // Turn UP at t=216: player presses W
  const afterTurn1 = view.sample(world, 'p0', { w: true }, 216, false);
  assert.equal(afterTurn1.x, beforeTurn.x, 'x position must NOT pull backward on corner turn');
  assert.ok(afterTurn1.y < 300, 'y position must advance upward');

  // Continues upward for next frames: X coordinate must remain stable, not dragged backward
  for (let t = 232; t <= 300; t += 16) {
    const v = view.sample(world, 'p0', { w: true }, t, false);
    assert.equal(v.x, beforeTurn.x, `x position must stay rock solid at ${beforeTurn.x} while moving up`);
  }
});

test('LocalMovement maintains full forward velocity along open axis during diagonal wall sliding', async () => {
  const { LocalMovement } = await import('../../public/js/presentation-demo/movement.mjs');
  const f = studio(), world = f.runtime.room.gameplay;
  const p = world.players.p0;
  // y=138 is against the top boundary of scene 'home' (radius 10, floor y=128)
  Object.assign(p, { scene: 'home', instance: 'home:p0', x: 300, y: 138, facing: 'right', facingDir: 1 });
  const view = new LocalMovement();
  view.sample(world, 'p0', {}, 0, false);

  let prevX = 300;
  for (let t = 16; t <= 320; t += 16) {
    if (t % 48 === 0) {
      // Server lags by 20px
      p.x = prevX - 20;
      p.y = 138;
      world.tickAt = t;
    }
    // Pressing W + D against the top wall: W is blocked by wall, D slides right
    const v = view.sample(world, 'p0', { w: true, d: true }, t, false);
    assert.ok(v.x > prevX + 1.0, `sliding along wall must advance at full diagonal speed, got ${v.x - prevX}`);
    assert.equal(v.y, 138, 'y stays constrained at wall boundary');
    prevX = v.x;
  }
  assert.ok(prevX >= 324, `after 320ms, wall slide must have reached >= 324px, got ${prevX}`);
});

test('stepWorld sets facing and facingDir on diagonal movement avoiding moonwalking', async () => {
  const { createWorld, stepWorld } = await import('../../public/prototypes/bel-working-as-equals-demo/world/simulation.mjs');
  const session = {
    id: 'test-session',
    players: {
      p0: { id: 'p0', location: { sceneId: 'home', instanceId: 'home:p0' }, connected: true },
      p1: { id: 'p1', location: { sceneId: 'home', instanceId: 'home:p0' }, connected: true },
      p2: { id: 'p2', location: { sceneId: 'home', instanceId: 'home:p0' }, connected: true },
      p3: { id: 'p3', location: { sceneId: 'home', instanceId: 'home:p0' }, connected: true }
    }
  };
  const base = { presentation: { active: false }, pauseReasons: [], players: session.players };
  const world = createWorld(session);
  assert.equal(world.players.p0.facingDir, 1, 'initial facingDir is 1');

  // Move down-left (A + S)
  const inputs = { p0: { keys: { a: true, s: true }, at: 1000, blocked: false } };
  stepWorld(world, base, inputs, 0.033, 1000);
  assert.equal(world.players.p0.facing, 'left', 'down-left movement must face left');
  assert.equal(world.players.p0.facingDir, -1, 'down-left movement must have facingDir -1');

  // Move up-right (W + D)
  inputs.p0.keys = { w: true, d: true };
  stepWorld(world, base, inputs, 0.033, 1033);
  assert.equal(world.players.p0.facing, 'right', 'up-right movement must face right');
  assert.equal(world.players.p0.facingDir, 1, 'up-right movement must have facingDir 1');
});

test('vector avatar alternates lifting both legs during walking motion', async () => {
  const { avatar } = await import('../../public/prototypes/bel-working-as-equals-demo/world/sprites.mjs');
  const calls = [];
  const fakeCtx = {
    save: () => {}, restore: () => {},
    translate: () => {}, scale: () => {},
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    fillRect: (x, y, w, h) => calls.push({ x, y, w, h }),
    fill: () => {}, stroke: () => {}, strokeRect: () => {},
    beginPath: () => {}, ellipse: () => {},
    measureText: () => ({ width: 20 }), fillText: () => {}
  };

  const profile = { name: 'Taylor', gender: 'female', appearance: { shirt: 'teal' }, id: 'p1' };
  calls.length = 0;
  avatar(fakeCtx, { x: 300, y: 300, pose: 'walking', facing: 'right', facingDir: 1, distance: 0 }, profile, 1000, false, null);
  const callsPhase0 = [...calls];
  calls.length = 0;
  avatar(fakeCtx, { x: 300, y: 300, pose: 'walking', facing: 'right', facingDir: 1, distance: 30 }, profile, 1000, false, null);
  const callsPhasePi = [...calls];

  const leg1_0 = callsPhase0.find(c => c.w === 6 && c.h === 14 && c.x < 0);
  const leg1_pi = callsPhasePi.find(c => c.w === 6 && c.h === 14 && c.x < 0);
  assert.ok(leg1_0 && leg1_pi, 'leg 1 foot outline must be rendered in both calls');
  assert.notEqual(leg1_0.y, leg1_pi.y, 'leg 1 y must differ between stance and swing phase');
});

