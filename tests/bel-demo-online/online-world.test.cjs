const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { AuthoritativeRuntime } = require('../../functions/src/crm/presentation-demo/runtime.cjs');

function fixture() {
    let now = 1000;
    const room = createRoomState({ roomId: 'physical-world', code: 'ABCD23', presenterUid: 'admin', now });
    for (let i = 1; i <= 3; i++) { room.slots['p' + i].uid = 'person-' + i; room.slots['p' + i].joinedAt = now; }
    const runtime = new AuthoritativeRuntime(room, { clock: () => now });
    for (const id of ['p0', 'p1', 'p2', 'p3']) { runtime.connect(id); runtime.markBootstrap(id); runtime.room.slots[id].activity.ready = true; }
    const seq = { p0: 0, p1: 0, p2: 0, p3: 0 };
    const command = (id, value) => runtime.command(id, 1, { ...value, seq: (value.type === 'move' ? runtime.room.lastInputSeq[id] : runtime.room.lastCommandSeq[id]) + 1 }, now);
    return { runtime, command, advance(ms) { now += ms; runtime.tick(now); }, place(id, scene, x, y) {
        Object.assign(runtime.room.gameplay.players[id], { scene, instance: scene === 'home' ? 'home:' + id : scene, x, y });
        Object.assign(runtime.room.slots[id], { scene, instanceId: scene === 'home' ? 'home:' + id : scene, position: { x, y } });
    }, action(id, action, payload = {}) { const p = runtime.room.gameplay.players[id]; return command(id, { type: 'world', action, payload: { instance: p.instance, ...(p.scene === 'F' ? { generation: runtime.room.gameplay.bridge.generation } : {}), ...payload } }); } };
}

test('RTDB omitted nullable relationships are restored before a transaction write', () => {
    const f = fixture();
    for (const player of Object.values(f.runtime.room.gameplay.players)) {
        for (const key of ['leader', 'follower', 'carry', 'request', 'seat', 'ride']) delete player[key];
    }
    f.advance(100);
    for (const slot of Object.values(f.runtime.room.slots)) assert.deepEqual(slot.relationship, { leader: null, follower: null, carry: null, handhold: null });
    const findUndefined = value => {
        if (value && typeof value === 'object') for (const item of Object.values(value)) { assert.notEqual(item, undefined); findUndefined(item); }
    };
    findUndefined(f.runtime.room);
});

test('movement is a timed intention; authored floor geometry bounds the committed position', () => {
    const f = fixture(), p = f.runtime.room.gameplay.players.p1;
    const x = p.x;
    f.command('p1', { type: 'move', dx: 1, dy: 0 });
    assert.equal(p.x, x, 'command receipt does not fabricate movement');
    f.advance(100);
    assert.ok(Math.abs(p.x - x - 10.8) < 0.001);
    f.advance(400);
    const stopped = p.x;
    f.advance(100);
    assert.equal(p.x, stopped, 'stale key input stops after 300 ms');
    f.place('p1', 'home', 839, 150);
    f.command('p1', { type: 'move', dx: 1, dy: 0 }); f.advance(100);
    assert.ok(p.x <= 840, 'feet stay inside the authored walkable floor');
});

test('door entry requires proximity and transitions only the actor and accepted follower', () => {
    const f = fixture();
    assert.throws(() => f.action('p1', 'enter', { target: 'exit' }), /Walk closer/);
    f.place('p1', 'home', 500, 401);
    f.action('p1', 'enter', { target: 'exit' });
    assert.equal(f.runtime.room.slots.p1.scene, 'street');
    assert.equal(f.runtime.room.slots.p2.scene, 'home');
    assert.equal(f.runtime.room.gameplay.players.p1.transitionUntil, 1500);
});

test('accepted handholding and carried objects clear on a disconnected participant', () => {
    const f = fixture();
    f.place('p1', 'reception', 400, 350); f.place('p2', 'reception', 430, 350);
    f.action('p1', 'social', { target: 'p2', action: 'hold' }); f.action('p2', 'accept');
    assert.equal(f.runtime.room.gameplay.players.p1.follower, 'p2');
    f.runtime.setPresence('p2', false, 1000, 1);
    assert.equal(f.runtime.room.gameplay.players.p1.follower, null);
    assert.equal(f.runtime.room.gameplay.players.p2.leader, null);
});

test('a monitor requires physical arrival; offline participants do not block a ready group', () => {
    const f = fixture();
    f.command('p0', { type: 'transition', to: 'playing' });
    assert.throws(() => f.command('p0', { type: 'presentation', action: 'open' }), { code: 'ARRIVAL_REQUIRED' });
    for (const id of ['p0', 'p1', 'p2']) f.place(id, 'A', 630, 175 + Number(id[1]) * 30);
    f.runtime.setPresence('p3', false, 1000, 1);
    f.command('p0', { type: 'presentation', action: 'open' });
    assert.equal(f.runtime.room.deck.room, 'A');
    assert.equal(f.runtime.room.gameplay.presentation.active, true);
    assert.throws(() => f.command('p0', { type: 'slide', room: 'C', slide: 4 }), { code: 'PROGRESSION_REQUIRED' });
});

test('reconnect preserves a short-lease handhold and restores only an unchanged unclaimed object', () => {
    const f = fixture(); f.place('p1', 'B1', 270, 316); f.place('p2', 'B1', 310, 316);
    f.action('p1', 'social', { target: 'p2', action: 'hold' }); f.action('p2', 'accept');
    f.runtime.replaceConnection('p2');
    assert.equal(f.runtime.room.gameplay.players.p2.leader, 'p1');
    f.runtime.setPresence('p2', false, 1000, 2);
    assert.equal(f.runtime.room.gameplay.players.p1.follower, null);
    f.action('p1', 'interact', { target: 'shape-0' });
    f.runtime.setPresence('p1', false, 1000, 1);
    const object = f.runtime.room.gameplay.routes.B1[0];
    assert.equal(object.owner, null);
    f.runtime.connect('p1');
    assert.equal(object.owner, 'p1');
    f.runtime.setPresence('p1', false, 1000, 2);
    object.owner = 'p2'; f.runtime.room.gameplay.players.p2.carry = object.id;
    f.runtime.connect('p1');
    assert.equal(object.owner, 'p2');
    assert.equal(f.runtime.room.gameplay.players.p1.carry, null);
    assert.equal(f.runtime.room.gameplay.players.p1.follower, null);
});

test('reconnect reconciles a completed section and retains the authoritative penalty duration', () => {
    const f = fixture(); f.place('p1', 'B2', 166, 362);
    f.runtime.setPresence('p1', false, 1000, 1);
    f.runtime.room.gameplay.cStarted = true;
    f.runtime.connect('p1');
    assert.equal(f.runtime.room.slots.p1.scene, 'C');
    assert.equal(f.runtime.room.slots.p1.recoveryReason, 'section-completed');
    f.place('p1', 'I', 310, 300);
    f.runtime.room.gameplay.reversal.debuffs.p1 = 12000;
    f.runtime.replaceConnection('p1');
    assert.equal(f.runtime.room.gameplay.reversal.debuffs.p1, 12000);
});

test('rehydration releases orphaned object owners without taking a valid carrier claim', () => {
    const f = fixture(); f.place('p1', 'B1', 270, 316); f.action('p1', 'interact', { target: 'shape-0' });
    const state = f.runtime.rawState();
    state.gameplay.routes.B1[1].owner = 'missing-player';
    state.gameplay.cubes.cubes[0].owner = 'p2';
    const restored = new AuthoritativeRuntime(state);
    restored.tick(1001);
    assert.equal(restored.room.gameplay.routes.B1[0].owner, 'p1');
    assert.equal(restored.room.gameplay.players.p1.carry, 'shape-0');
    assert.equal(restored.room.gameplay.routes.B1[1].owner, null);
    assert.equal(restored.room.gameplay.cubes.cubes[0].owner, null);
});

test('bridge timers continue after either role disconnects; only explicit pause stops them', () => {
    const f = fixture(); f.command('p0', { type: 'transition', to: 'playing' });
    for (const id of ['p0', 'p1', 'p2', 'p3']) f.place(id, 'F', 350 + Number(id[1]) * 68, 375);
    f.action('p0', 'activity', { action: 'start' });
    f.runtime.setPresence('p3', false, 1000, 1); f.advance(1000);
    assert.equal(f.runtime.room.gameplay.bridge.remaining, 59000);
    f.runtime.setPresence('p0', false, 2000, 1); f.advance(1000);
    assert.equal(f.runtime.room.gameplay.bridge.remaining, 58000);
    f.runtime.room.gameplay.paused = true; f.advance(1000);
    assert.equal(f.runtime.room.gameplay.bridge.remaining, 58000);
});

test('a participant cannot submit a completed bridge or choose a floor answer by payload', () => {
    const f = fixture(); f.command('p0', { type: 'transition', to: 'playing' });
    f.place('p1', 'F', 500, 375);
    assert.throws(() => f.command('p1', { type: 'activity', action: 'bridge', payload: { op: 'place', index: 0, instance: 'F', generation: 0 } }), /Presenter activity control/);
    f.place('p1', 'I', 500, 375);
    assert.throws(() => f.command('p1', { type: 'activity', action: 'reversal', payload: { op: 'choose', choice: 'Do', instance: 'I' } }), /Presenter activity control/);
});

test('owner-free recovery advances all elapsed bridge phases beyond the movement integration cap', () => {
    const f = fixture(); f.command('p0', { type: 'transition', to: 'playing' });
    for (const id of ['p0', 'p1', 'p2', 'p3']) f.place(id, 'F', 350 + Number(id[1]) * 68, 375);
    f.action('p0', 'activity', { action: 'start' });
    f.advance(600000);
    assert.equal(f.runtime.room.gameplay.bridge.generation, 13);
    assert.equal(f.runtime.room.gameplay.bridge.phase, 'attempt');
    assert.equal(f.runtime.room.gameplay.bridge.remaining, 10000);
    assert.ok(Object.values(f.runtime.room.slots).every(slot => !slot.connected));
});
