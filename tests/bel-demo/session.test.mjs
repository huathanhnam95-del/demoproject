import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyCommand, publicSnapshot, setLocation, setPresence } from '../../public/prototypes/bel-working-as-equals-demo/state/session.mjs';
import { presentationReadiness, locationFor, SCENES, PRESENTATION_ROOMS } from '../../public/prototypes/bel-working-as-equals-demo/state/progression.mjs';
import { createHostStore, createDraftStore, createResumeStore } from '../../public/prototypes/bel-working-as-equals-demo/state/storage.mjs';
import { createHost, createClient } from '../../public/prototypes/bel-working-as-equals-demo/state/protocol.mjs';

const roles = ['p0', 'p1', 'p2', 'p3'];
const seed = () => createSession({ id: 'bel-demo-test', now: 100 });
let nextCommand = 0;
function command(bundle, type, payload = {}, id = `command-${++nextCommand}`) {
  return { id, sessionId: bundle.state.id, expectedRevision: bundle.state.revision, type, payload };
}
function run(bundle, actor, type, payload = {}) {
  if (type === 'player.ready') payload = { loadRevision: bundle.state.players[actor].loadRevision, ...payload };
  return applyCommand(bundle, actor, command(bundle, type, payload), 200).bundle;
}
function expectCode(fn, code) { assert.throws(fn, error => error.code === code); }
class MemoryStorage {
  values = new Map();
  fail = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.fail) throw new Error('disk full'); this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
class FakeClock {
  time = 1000;
  callbacks = new Set();
  now = () => this.time;
  setInterval = callback => { this.callbacks.add(callback); return callback; };
  clearInterval = callback => this.callbacks.delete(callback);
  tick(ms) { this.time += ms; for (const callback of [...this.callbacks]) callback(); }
}
function fakeBus() {
  const channels = new Set();
  const packets = [];
  return {
    packets,
    get size() { return channels.size; },
    factory(name) {
      const listeners = new Set();
      const channel = {
        name, closed: false,
        addEventListener: (_, callback) => listeners.add(callback),
        removeEventListener: (_, callback) => listeners.delete(callback),
        postMessage(data) {
          packets.push(structuredClone(data));
          for (const other of channels) if (other !== channel && other.name === name) {
            const copy = structuredClone(data);
            queueMicrotask(() => { if (!other.closed) other.deliver(copy); });
          }
        },
        deliver(data) { for (const listener of listeners) listener({ data }); },
        close() { channel.closed = true; channels.delete(channel); }
      };
      channels.add(channel);
      return channel;
    }
  };
}
function fakeLocks() {
  const held = new Set();
  return { async request(name, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
async function fixture(t) {
  const bus = fakeBus();
  const clock = new FakeClock();
  const storage = new MemoryStorage();
  const store = createHostStore(storage, 'bel-demo-test');
  const locks = fakeLocks();
  const initialBundle = seed();
  const options = { sessionId: 'bel-demo-test', initialBundle, ownerToken: initialBundle.credentials.p0, store, channelFactory: bus.factory, locks, clock };
  const host = await createHost(options);
  const clients = roles.map(actorId => createClient({ ...host.invite(actorId), channelFactory: bus.factory, clock }));
  await flush();
  t.after(async () => { clients.forEach(client => client.close()); await host.close(); await flush(); });
  return { bus, clock, storage, store, locks, host, clients, options };
}

test('four reserved identities: private Homes, presenter Reception, no credentials in snapshots', () => {
  const bundle = seed();
  const state = publicSnapshot(bundle);
  assert.deepEqual(Object.keys(state.players), roles);
  assert.equal(state.players.p0.role, 'presenter');
  assert.equal(state.players.p0.gender, 'male');
  assert.equal(state.players.p0.location.instanceId, 'reception');
  for (const id of roles.slice(1)) {
    assert.equal(state.players[id].gender, 'female');
    assert.deepEqual(state.players[id].location, { sceneId: 'home', instanceId: `home:${id}`, atScreen: false });
  }
  assert.equal(new Set(Object.values(bundle.credentials)).size, 4);
  assert.equal('credentials' in state, false);
  state.players.p1.name = 'modified snapshot';
  assert.notEqual(bundle.state.players.p1.name, state.players.p1.name);
});

test('own profile and notes only; participant cannot invoke presenter controls', () => {
  let bundle = seed();
  bundle = run(bundle, 'p1', 'profile.set', { name: 'Ava', appearance: { hat: 'cap', glasses: true, shirt: 'teal' } });
  assert.equal(bundle.state.players.p1.name, 'Ava');
  assert.equal(bundle.state.players.p2.name, 'Participant 2');
  expectCode(() => run(bundle, 'p1', 'profile.set', { name: 'Hijack', actorId: 'p0' }), 'INVALID_PAYLOAD');
  for (const type of ['session.pause', 'session.resume', 'presentation.open', 'presentation.close']) {
    expectCode(() => run(bundle, 'p1', type, type === 'presentation.open' ? { roomId: 'A' } : {}), 'FORBIDDEN');
  }
  bundle = run(bundle, 'p0', 'session.pause');
  assert.deepEqual(bundle.state.pauseReasons, ['presenter']);
  bundle = run(bundle, 'p1', 'notes.save', { pageId: 'page-1', title: 'Idea', body: 'My next step', expectedVersion: 0 });
  assert.equal(bundle.state.players.p1.notes[0].body, 'My next step');
  assert.equal(bundle.state.players.p0.notes.length, 0);
});

test('multi-page notes use page versions and preserve other players and pages', () => {
  let bundle = seed();
  for (const pageId of ['one', 'two']) bundle = run(bundle, 'p1', 'notes.save', { pageId, title: pageId, body: pageId, expectedVersion: 0 });
  bundle = run(bundle, 'p2', 'notes.save', { pageId: 'one', title: 'Other', body: 'Independent', expectedVersion: 0 });
  bundle = run(bundle, 'p1', 'notes.save', { pageId: 'one', title: 'Edited', body: 'Changed', expectedVersion: 1 });
  expectCode(() => run(bundle, 'p1', 'notes.save', { pageId: 'one', title: 'Stale', body: 'Lost edit', expectedVersion: 1 }), 'NOTE_CONFLICT');
  bundle = run(bundle, 'p1', 'notes.delete', { pageId: 'two', expectedVersion: 1 });
  assert.deepEqual(bundle.state.players.p1.notes.map(page => [page.id, page.body, page.version]), [['one', 'Changed', 2]]);
  assert.equal(bundle.state.players.p2.notes[0].body, 'Independent');
  expectCode(() => run(bundle, 'p2', 'notes.delete', { pageId: 'two', expectedVersion: 1 }), 'NOTE_CONFLICT');
});

test('command replay is exact-once, actor-bound and detects altered ID reuse', () => {
  const original = seed();
  const envelope = command(original, 'notes.save', { pageId: 'one', title: 'A', body: 'Saved once', expectedVersion: 0 });
  const accepted = applyCommand(original, 'p1', envelope, 200);
  const replay = applyCommand(accepted.bundle, 'p1', envelope, 999);
  assert.equal(replay.bundle.state.revision, accepted.bundle.state.revision);
  assert.deepEqual(replay.result, accepted.result);
  assert.equal(replay.bundle.state.players.p1.notes[0].version, 1);
  expectCode(() => applyCommand(accepted.bundle, 'p1', { ...envelope, payload: { ...envelope.payload, body: 'different' } }, 300), 'COMMAND_ID_REUSED');
  const independent = applyCommand(accepted.bundle, 'p2', envelope, 300);
  assert.equal(independent.bundle.state.players.p2.notes[0].body, 'Saved once');
  assert.equal(independent.bundle.state.players.p1.notes[0].version, 1);
  expectCode(() => applyCommand(original, 'p1', { ...envelope, sessionId: 'different' }, 300), 'WRONG_SESSION');
});

test('presentation requires the whole loaded group and presenter at its physical screen', () => {
  let bundle = seed();
  for (const actor of roles) {
    bundle = setPresence(bundle, actor, true);
    bundle = setLocation(bundle, actor, 'A', actor === 'p0');
    if (actor !== 'p3') bundle = run(bundle, actor, 'player.ready', { sceneId: 'A', instanceId: 'A' });
  }
  assert.deepEqual(presentationReadiness(bundle.state, 'A').missing, ['p3']);
  expectCode(() => run(bundle, 'p0', 'presentation.open', { roomId: 'A' }), 'GROUP_NOT_READY');
  expectCode(() => run(bundle, 'p3', 'player.ready', { sceneId: 'home', instanceId: 'home:p3' }), 'WRONG_ROOM');
  bundle = run(bundle, 'p3', 'player.ready', { sceneId: 'A', instanceId: 'A' });
  bundle = setLocation(bundle, 'p0', 'A', false);
  bundle = run(bundle, 'p0', 'player.ready', { sceneId: 'A', instanceId: 'A' });
  expectCode(() => run(bundle, 'p0', 'presentation.open', { roomId: 'A' }), 'NOT_AT_SCREEN');
  bundle = setLocation(bundle, 'p0', 'A', true);
  bundle = run(bundle, 'p0', 'player.ready', { sceneId: 'A', instanceId: 'A' });
  bundle = run(bundle, 'p0', 'presentation.open', { roomId: 'A' });
  assert.equal(bundle.state.presentation.active, true);
  bundle = run(bundle, 'p2', 'notes.save', { pageId: 'during-slides', title: 'Keep', body: 'Still can write', expectedVersion: 0 });
  assert.equal(bundle.state.players.p2.notes.length, 1);
  bundle = run(bundle, 'p0', 'presentation.close');
  assert.equal(bundle.state.presentation.active, false);
  expectCode(() => setLocation(bundle, 'p1', 'not-a-room'), 'INVALID_ROOM');
});

test('host saves round-trip; malformed saves fail instead of silently resetting data', () => {
  const storage = new MemoryStorage();
  const store = createHostStore(storage, 'bel-demo-test');
  let bundle = run(seed(), 'p1', 'notes.save', { pageId: 'one', title: 'Saved', body: 'Retain me', expectedVersion: 0 });
  store.save(bundle);
  assert.deepEqual(store.load(), bundle);
  const key = [...storage.values.keys()][0];
  storage.values.set(key, '{broken');
  expectCode(() => store.load(), 'CORRUPT_SAVE');
  assert.equal(storage.values.get(key), '{broken');
  bundle.state.players.p1.notes[0].version = -1;
  storage.values.set(key, JSON.stringify(bundle));
  expectCode(() => store.load(), 'CORRUPT_SAVE');
});

test('unsaved notebook drafts are separate from session saves and isolated by player', () => {
  const storage = new MemoryStorage();
  const drafts = createDraftStore(storage, 'bel-demo-test', 'p1');
  drafts.save('one', { title: 'Draft', body: 'Not submitted' });
  assert.deepEqual(drafts.load('one'), { title: 'Draft', body: 'Not submitted' });
  assert.equal(createDraftStore(storage, 'bel-demo-test', 'p2').load('one'), null);
  assert.equal(createHostStore(storage, 'bel-demo-test').load(), null);
  drafts.remove('one');
  assert.equal(drafts.load('one'), null);
});

test('four clients converge after concurrent saves, with no lost notes or leaked credential bundle', async t => {
  const { clients, host, bus } = await fixture(t);
  assert.deepEqual(clients.map(client => client.status), roles.map(() => 'online'));
  await Promise.all(clients.map((client, index) => client.command('notes.save', { pageId: 'shared-time', title: `P${index}`, body: `Note ${index}`, expectedVersion: 0 })));
  await flush();
  for (const client of clients) assert.deepEqual(client.state, host.state);
  assert.deepEqual(roles.map(id => host.state.players[id].notes[0].body), ['Note 0', 'Note 1', 'Note 2', 'Note 3']);
  assert.ok(bus.packets.filter(packet => packet.state).every(packet => !('credentials' in packet.state)));
});

test('failed persistence rejects the edit without publishing or committing it', async t => {
  const { storage, host, clients } = await fixture(t);
  const before = host.state;
  storage.fail = true;
  await assert.rejects(clients[1].command('notes.save', { pageId: 'one', title: 'Failed', body: 'Not saved', expectedVersion: 0 }), error => error.code === 'PERSISTENCE_FAILED');
  assert.deepEqual(host.state, before);
  assert.deepEqual(clients[1].state, before);
  storage.fail = false;
});

test('bad credentials and duplicate active seats cannot acquire another avatar', async t => {
  const { host, bus, clock } = await fixture(t);
  expectCode(() => createClient({ ...host.invite('p1'), token: 'short', channelFactory: bus.factory, clock }), 'INVALID_PAYLOAD');
  const bad = createClient({ ...host.invite('p1'), token: 'wrong-token-that-is-long-enough-to-validate', channelFactory: bus.factory, clock });
  const duplicate = createClient({ ...host.invite('p1'), channelFactory: bus.factory, clock });
  t.after(() => { bad.close(); duplicate.close(); });
  await flush();
  assert.equal(bad.state, null);
  assert.notEqual(bad.status, 'online'); // A wrong credential cannot address a host seat channel.
  assert.equal(bad.paused, true);
  assert.equal(duplicate.status, 'seat-busy');
  assert.equal(Object.keys(host.state.players).length, 4);
});

test('refresh rejoins the same identity and preserves saved pages', async t => {
  const { host, clients, bus, clock } = await fixture(t);
  await clients[1].command('profile.set', { name: 'Ava' });
  await clients[1].command('notes.save', { pageId: 'one', title: 'First', body: 'Remember', expectedVersion: 0 });
  clients[1].close();
  await flush();
  const resumed = createClient({ ...host.invite('p1'), channelFactory: bus.factory, clock });
  t.after(() => resumed.close());
  await flush();
  assert.equal(resumed.status, 'online');
  assert.equal(resumed.state.players.p1.name, 'Ava');
  assert.equal(resumed.state.players.p1.notes[0].body, 'Remember');
  assert.equal(resumed.state.players.p1.ready, false);
});

test('exclusive host lock prevents a second writer; restored host preserves data and pauses recovery', async t => {
  const { host, clients, options, clock } = await fixture(t);
  await assert.rejects(createHost(options), error => error.code === 'HOST_EXISTS');
  await clients[1].command('notes.save', { pageId: 'one', title: 'Keep', body: 'Survives host reload', expectedVersion: 0 });
  await host.close();
  await flush();
  assert.equal(clients[1].paused, true);
  const restored = await createHost(options);
  t.after(() => restored.close());
  clock.tick(1000);
  await flush();
  assert.equal(clients[1].status, 'online');
  assert.equal(restored.state.players.p1.notes[0].body, 'Survives host reload');
  assert.deepEqual(restored.state.pauseReasons, ['recovery']);
  assert.ok(roles.every(id => !restored.state.players[id].ready));
  await clients[0].command('session.resume');
  assert.deepEqual(restored.state.pauseReasons, []);
});

test('expired connection leases release seats and stale snapshots cannot roll back edits', async t => {
  const { host, clients, bus, clock } = await fixture(t);
  const stale = clients[1].state;
  await clients[1].command('notes.save', { pageId: 'one', title: 'New', body: 'Latest', expectedVersion: 0 });
  const oldSnapshot = bus.packets.find(packet => packet.kind === 'snapshot');
  const injector = bus.factory(host.channelName('p1'));
  injector.postMessage({ ...oldSnapshot, connectionId: clients[1].connectionId, state: stale });
  await flush();
  assert.equal(clients[1].state.players.p1.notes[0].body, 'Latest');
  injector.close();
  // A suspended tab stops heartbeats without sending a graceful goodbye.
  clients[2].close({ notifyHost: false });
  clock.tick(7000);
  await flush();
  assert.equal(host.state.players.p2.connected, false);
  const replacement = createClient({ ...host.invite('p2'), channelFactory: bus.factory, clock });
  t.after(() => replacement.close());
  await flush();
  assert.equal(replacement.status, 'online');
});

test('known scene identities and owner-scoped Home enforce the room contract', () => {
  assert.deepEqual(SCENES, ['home', 'street', 'reception', 'A', 'B1', 'B2', 'B3', 'C', 'D', 'E', 'F', 'G', 'I', 'J']);
  assert.notDeepEqual(locationFor('p1', 'A'), locationFor('p1', 'C'));
  expectCode(() => locationFor('p0', 'home'), 'INVALID_ROOM');
  expectCode(() => locationFor('p4', 'home'), 'INVALID_ACTOR');
  for (const room of ['H', 'K']) expectCode(() => locationFor('p1', room), 'INVALID_ROOM');
  assert.equal(seed().state.brand, 'Better English Learning');
});

test('deleted page versions reject stale resurrection while independent stale-revision edits merge', () => {
  const first = seed();
  const envelope = command(first, 'notes.save', { pageId: 'one', title: 'One', body: 'Old', expectedVersion: 0 });
  let bundle = applyCommand(first, 'p1', envelope, 200).bundle;
  bundle = run(bundle, 'p1', 'notes.delete', { pageId: 'one', expectedVersion: 1 });
  expectCode(() => run(bundle, 'p1', 'notes.save', envelope.payload), 'NOTE_CONFLICT');
  const independent = command(first, 'notes.save', { pageId: 'two', title: 'Two', body: 'Independent', expectedVersion: 0 });
  bundle = applyCommand(bundle, 'p1', independent, 300).bundle;
  assert.deepEqual(bundle.state.players.p1.notes.map(page => page.id), ['two']);
  expectCode(() => applyCommand(bundle, 'p1', { ...independent, id: 'future', expectedRevision: 999 }, 300), 'STALE_REVISION');
  expectCode(() => run(bundle, 'p1', 'player.teleport', { sceneId: 'A' }), 'INVALID_COMMAND');
});

test('nested malformed saves, extra seats and leaked fields are rejected without overwriting storage', () => {
  const storage = new MemoryStorage();
  const store = createHostStore(storage, 'bel-demo-test');
  store.save(seed());
  const key = [...storage.values.keys()][0];
  const corruptions = [
    b => { b.state.players.p4 = structuredClone(b.state.players.p1); },
    b => { b.state.players.p1.location.instanceId = 'home:p2'; },
    b => { b.credentials.p1 = b.credentials.p0; },
    b => { b.state.players.p1.ready = 'true'; },
    b => { b.state.credentials = b.credentials; },
    b => { b.state.revision = -1; },
    b => { b.state.players.p1.notes = [{ id: 'one', title: 'A', body: 'B', version: 1, updatedAt: 1 }]; },
    b => { b.receipts = [{ actorId: 'p1', command: {}, result: {} }]; }
  ];
  for (const corrupt of corruptions) {
    const bundle = seed();
    corrupt(bundle);
    const raw = JSON.stringify(bundle);
    storage.values.set(key, raw);
    expectCode(() => store.load(), 'CORRUPT_SAVE');
    assert.equal(storage.values.get(key), raw);
  }
});

test('per-tab resume storage and draft versions round-trip separately from shared notes', () => {
  const storage = new MemoryStorage();
  const resume = createResumeStore(storage, 'bel-demo-test');
  const invitation = { sessionId: 'bel-demo-test', actorId: 'p2', token: seed().credentials.p2 };
  resume.save(invitation);
  assert.deepEqual(resume.load(), invitation);
  const drafts = createDraftStore(storage, 'bel-demo-test', 'p2');
  const draft = { title: 'Unsaved', body: 'Locally retained', expectedVersion: 4 };
  drafts.save('one', draft);
  assert.deepEqual(drafts.load('one'), draft);
  assert.equal(createHostStore(storage, 'bel-demo-test').load(), null);
  resume.remove();
  assert.equal(resume.load(), null);
});

test('trusted host world boundary gates presentation; client commands cannot teleport or forge loaded room', async t => {
  const { clients, host } = await fixture(t);
  await assert.rejects(clients[1].command('player.teleport', { sceneId: 'A', atScreen: true }), { code: 'INVALID_COMMAND' });
  await assert.rejects(clients[1].command('presentation.open', { roomId: 'A' }), { code: 'FORBIDDEN' });
  for (const actor of roles) await host.setLocation(actor, 'A', false);
  await assert.rejects(clients[3].command('player.ready', { sceneId: 'C', instanceId: 'C', loadRevision: clients[3].state.players.p3.loadRevision }), { code: 'WRONG_ROOM' });
  await Promise.all(clients.map((client, index) => client.command('player.ready', { sceneId: 'A', instanceId: 'A', loadRevision: client.state.players[roles[index]].loadRevision })));
  await assert.rejects(clients[0].command('presentation.open', { roomId: 'A' }), { code: 'NOT_AT_SCREEN' });
  await host.setLocation('p0', 'A', true);
  await flush();
  await clients[0].command('presentation.open', { roomId: 'A' });
  await clients[2].command('notes.save', { pageId: 'during', title: 'During slides', body: 'Works without an activity lock', expectedVersion: 0 });
  assert.equal(host.state.presentation.active, true);
  clients[3].close();
  await flush();
  assert.equal(clients[0].paused, true);
  assert.ok(host.state.pauseReasons.includes('group'));
  await clients[0].command('session.resume');
  assert.equal(clients[0].paused, true);
});

test('host ownership is presenter-bound and failed startup releases its exclusive lock', async () => {
  const initialBundle = seed();
  const storage = new MemoryStorage();
  const store = createHostStore(storage, 'bel-demo-test');
  const bus = fakeBus();
  const clock = new FakeClock();
  const options = { sessionId: 'bel-demo-test', initialBundle, store, locks: fakeLocks(), channelFactory: bus.factory, clock };
  await assert.rejects(createHost({ ...options, ownerToken: initialBundle.credentials.p1 }), { code: 'FORBIDDEN' });
  assert.equal(store.load(), null);
  storage.fail = true;
  await assert.rejects(createHost({ ...options, ownerToken: initialBundle.credentials.p0 }), { code: 'PERSISTENCE_FAILED' });
  storage.fail = false;
  const host = await createHost({ ...options, ownerToken: initialBundle.credentials.p0 });
  await host.close();
  assert.equal(bus.size, 0);
  assert.equal(clock.callbacks.size, 0);
});

test('replay receipts survive recovery and forged commands cannot use another active connection', async t => {
  const { host, clients, options, bus, clock, store } = await fixture(t);
  const envelope = { id: 'replay-after-reload', expectedRevision: clients[1].state.revision };
  const payload = { pageId: 'durable', title: 'Durable', body: 'Only once', expectedVersion: 0 };
  const result = await clients[1].command('notes.save', payload, envelope);
  const injector = bus.factory(host.channelName('p1'));
  const before = host.state;
  injector.postMessage({ kind: 'command', connectionId: 'fake-connection', epoch: host.epoch,
    command: { id: 'forged', sessionId: before.id, expectedRevision: before.revision, type: 'session.pause', payload: {} } });
  await flush();
  assert.deepEqual(host.state, before);
  injector.close();
  await host.setLocation('p1', 'C');
  await host.close();
  const restored = await createHost(options);
  t.after(() => restored.close());
  assert.ok(roles.every(id => !restored.state.players[id].connected && !restored.state.players[id].ready));
  assert.equal(restored.state.players.p1.location.sceneId, 'C');
  clock.tick(1000);
  await flush();
  assert.deepEqual(await clients[1].command('notes.save', payload, envelope), result);
  assert.equal(store.load().state.players.p1.notes[0].version, 1);
  assert.ok(bus.packets.every(packet => !JSON.stringify(packet).includes(options.initialBundle.credentials.p0)));
});

test('loss of host heartbeats freezes clients; disposal removes every channel and timer', async t => {
  const { host, clients, bus, clock } = await fixture(t);
  await host.close({ notifyClients: false });
  clock.tick(7000);
  await flush();
  for (const client of clients) {
    assert.equal(client.paused, true);
    assert.equal(client.status, 'host-unavailable');
    await assert.rejects(client.command('session.resume'), { code: 'HOST_UNAVAILABLE' });
    client.close();
  }
  assert.equal(bus.size, 0);
  assert.equal(clock.callbacks.size, 0);
});

test('late room-loaded acknowledgements cannot satisfy a later visit or reconnect', () => {
  let bundle = setPresence(seed(), 'p1', true);
  bundle = setLocation(bundle, 'p1', 'A');
  const loaded = command(bundle, 'player.ready', { sceneId: 'A', instanceId: 'A', loadRevision: bundle.state.players.p1.loadRevision });
  bundle = setLocation(bundle, 'p1', 'C');
  bundle = setLocation(bundle, 'p1', 'A');
  expectCode(() => applyCommand(bundle, 'p1', loaded), 'STALE_LOAD');
  bundle = setPresence(bundle, 'p1', false);
  bundle = setPresence(bundle, 'p1', true);
  expectCode(() => applyCommand(bundle, 'p1', loaded), 'STALE_LOAD');
  assert.equal(bundle.state.players.p1.ready, false);
});

test('valid page identifiers do not collide with inherited object properties', () => {
  const bundle = run(seed(), 'p1', 'notes.save', { pageId: 'constructor', title: 'One', body: 'Text', expectedVersion: 0 });
  assert.equal(bundle.state.players.p1.notes[0].body, 'Text');
});

test('background persistence failure is visible, pauses clients and recovers without changing committed state', async t => {
  const { host, clients, storage, clock } = await fixture(t);
  const before = host.state;
  clients[2].close({ notifyHost: false });
  storage.fail = true;
  clock.tick(7000);
  await flush();
  assert.deepEqual(host.state, before);
  assert.equal(host.storageError, 'PERSISTENCE_FAILED');
  for (const client of [clients[0], clients[1], clients[3]]) {
    assert.equal(client.storageError, 'PERSISTENCE_FAILED');
    assert.equal(client.paused, true);
  }
  storage.fail = false;
  clock.tick(1000);
  await flush();
  assert.equal(host.storageError, null);
  assert.equal(host.state.players.p2.connected, false);
  assert.equal(clients[1].status, 'online');
  assert.equal(clients[1].storageError, null);
});

test('active presentation pauses every client while notes remain usable until slides close', async t => {
  const { host, clients } = await fixture(t);
  for (const actor of roles) await host.setLocation(actor, 'A', actor === 'p0');
  await Promise.all(clients.map((client, index) => client.command('player.ready', {
    sceneId: 'A', instanceId: 'A', loadRevision: client.state.players[roles[index]].loadRevision
  })));
  await flush();
  assert.deepEqual(clients.map(client => client.paused), [false, false, false, false]);
  await clients[0].command('presentation.open', { roomId: 'A' });
  await flush();
  assert.deepEqual(clients.map(client => client.paused), [true, true, true, true]);
  await clients[2].command('notes.save', { pageId: 'slide-note', title: 'During slides', body: 'Saved while movement is paused', expectedVersion: 0 });
  assert.equal(host.state.players.p2.notes[0].body, 'Saved while movement is paused');
  await clients[0].command('session.resume');
  await flush();
  assert.equal(host.state.presentation.active, true);
  assert.deepEqual(clients.map(client => client.paused), [true, true, true, true]);
  await clients[0].command('presentation.close');
  await flush();
  assert.deepEqual(host.state.pauseReasons, []);
  assert.deepEqual(clients.map(client => client.paused), [false, false, false, false]);
});

test('presentation monitors are restricted to the six approved presentation rooms', () => {
  assert.deepEqual(PRESENTATION_ROOMS, ['A', 'C', 'E', 'G', 'I', 'J']);
  const bundle = setLocation(setPresence(seed(), 'p0', true), 'p0', 'B1');
  assert.equal(bundle.state.players.p0.location.sceneId, 'B1');
  expectCode(() => setLocation(bundle, 'p0', 'B1', true), 'INVALID_LOCATION');
  expectCode(() => run(bundle, 'p0', 'presentation.open', { roomId: 'B1' }), 'INVALID_ROOM');
});
