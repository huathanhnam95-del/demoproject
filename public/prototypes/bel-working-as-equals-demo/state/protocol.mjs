import { applyCommand, publicSnapshot, recoverSession, setLocation, setPresence, validateBundle, validateState, isId, isToken, isRecord } from './session.mjs';
import { SEATS, assertSeat, check, fail } from './progression.mjs';

const systemClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: id => globalThis.clearInterval(id)
};
const defaultChannel = name => new globalThis.BroadcastChannel(name);
const error = code => Object.assign(new Error(code), { code });
const channelName = (sessionId, actorId, token) => `bel-local:${sessionId}:seat:${actorId}:${token}`;

function post(channel, packet) {
  // A disappeared view must not turn an already committed action into a failure.
  // Missing messages are recovered by heartbeats and exact command replay.
  try { channel.postMessage(packet); } catch { /* recipient will time out */ }
}

async function acquireLock(locks, name) {
  check(locks && typeof locks.request === 'function', 'LOCKS_UNAVAILABLE');
  let release;
  let acquired;
  let rejected;
  const ready = new Promise((resolve, reject) => { acquired = resolve; rejected = reject; });
  const done = Promise.resolve().then(() => locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) fail('HOST_EXISTS');
    const held = new Promise(resolve => { release = resolve; });
    acquired();
    await held;
  }));
  done.catch(rejected);
  await ready;
  return { release, done };
}

/** Presenter-only host. store is a synchronous, atomic localStorage adapter.
 * Keep this object and the private bundle in the presenter view. Participants
 * receive only their invitation. Web Locks require a supported secure context.
 */
export async function createHost({ sessionId, initialBundle, ownerToken, store,
  locks = globalThis.navigator?.locks, channelFactory = defaultChannel, clock = systemClock,
  heartbeatMs = 1000, leaseMs = 6000 } = {}) {
  check(isId(sessionId) && store && typeof store.load === 'function' && typeof store.save === 'function');
  check(Number.isFinite(heartbeatMs) && heartbeatMs > 0 && Number.isFinite(leaseMs) && leaseMs > heartbeatMs);
  const lock = await acquireLock(locks, `bel-host:${sessionId}`);
  const channels = new Map();
  const live = new Map();
  let bundle;
  let timer;
  let closing = false;
  let closePromise;
  let storageError = null;
  let queue = Promise.resolve();
  const epoch = globalThis.crypto.randomUUID();

  function cleanup() {
    if (timer !== undefined) clock.clearInterval(timer);
    for (const { channel, listener } of channels.values()) {
      channel.removeEventListener('message', listener);
      channel.close();
    }
    channels.clear();
    live.clear();
  }
  function persist(next) {
    try {
      store.save(next);
      storageError = null;
    } catch {
      storageError = 'PERSISTENCE_FAILED';
      for (const [id, seat] of live) send(id, seat.connectionId, 'fault');
      fail('PERSISTENCE_FAILED');
    }
  }
  function commit(next) {
    if (next === bundle) return;
    persist(next);
    bundle = next;
  }
  function enqueue(operation) {
    const result = queue.then(() => {
      if (closing) fail('HOST_CLOSED');
      return operation();
    });
    queue = result.catch(() => {});
    return result;
  }
  function send(actorId, connectionId, kind, extra = {}) {
    post(channels.get(actorId).channel, { kind, epoch, connectionId, storageError, ...extra });
  }
  function publish() {
    const state = publicSnapshot(bundle);
    for (const [actorId, seat] of live) send(actorId, seat.connectionId, 'snapshot', { state });
  }
  function expire(actorId) {
    const seat = live.get(actorId);
    if (seat && clock.now() - seat.lastSeen >= leaseMs) {
      commit(setPresence(bundle, actorId, false));
      live.delete(actorId);
      send(actorId, seat.connectionId, 'rejected', { code: 'LEASE_EXPIRED' });
      publish();
    }
  }
  function receive(actorId, packet) {
    if (!isRecord(packet) || !isId(packet.connectionId)) return;
    if (!['hello', 'heartbeat', 'goodbye', 'command'].includes(packet.kind)) return;
    try {
      expire(actorId);
      const seat = live.get(actorId);
      if (packet.kind === 'hello') {
        if (seat && seat.connectionId !== packet.connectionId) fail('SEAT_BUSY');
        if (!seat) {
          commit(setPresence(bundle, actorId, true));
          live.set(actorId, { connectionId: packet.connectionId, lastSeen: clock.now() });
          publish();
        } else seat.lastSeen = clock.now();
        send(actorId, packet.connectionId, 'welcome', { state: publicSnapshot(bundle) });
        return;
      }
      check(packet.epoch === epoch && seat?.connectionId === packet.connectionId, 'NOT_CONNECTED');
      seat.lastSeen = clock.now();
      if (packet.kind === 'goodbye') {
        commit(setPresence(bundle, actorId, false));
        live.delete(actorId);
        publish();
      } else if (packet.kind === 'heartbeat') {
        send(actorId, packet.connectionId, 'snapshot', { state: publicSnapshot(bundle) });
      } else {
        const accepted = applyCommand(bundle, actorId, packet.command, clock.now());
        // Consult actual leases as well as persisted readiness. A failed expiry
        // save must never let a disconnected group start a presentation.
        if (packet.command.type === 'presentation.open' && accepted.bundle !== bundle) {
          check(SEATS.every(id => live.has(id) && clock.now() - live.get(id).lastSeen < leaseMs), 'GROUP_NOT_READY');
        }
        commit(accepted.bundle);
        publish();
        send(actorId, packet.connectionId, 'ack', { commandId: packet.command.id, result: accepted.result, state: publicSnapshot(bundle) });
      }
    } catch (cause) {
      send(actorId, packet.connectionId, packet.kind === 'command' ? 'nack' : 'rejected', {
        code: cause.code || 'INVALID_MESSAGE', ...(isId(packet.command?.id) ? { commandId: packet.command.id } : {})
      });
    }
  }

  try {
    const saved = store.load(); // Corruption is surfaced and never replaced with a seed.
    bundle = structuredClone(validateBundle(saved ?? initialBundle));
    check(bundle.state.id === sessionId, 'WRONG_SESSION');
    check(isToken(ownerToken) && ownerToken === bundle.credentials.p0, 'FORBIDDEN');
    if (saved) bundle = recoverSession(bundle);
    persist(bundle);
    for (const actorId of SEATS) {
      const channel = channelFactory(channelName(sessionId, actorId, bundle.credentials[actorId]));
      const listener = event => { void enqueue(() => receive(actorId, event.data)).catch(() => {}); };
      channels.set(actorId, { channel, listener });
      channel.addEventListener('message', listener);
    }
    timer = clock.setInterval(() => {
      void enqueue(() => {
        if (storageError) persist(bundle);
        for (const actorId of live.keys()) expire(actorId);
        publish();
      }).catch(() => {});
    }, heartbeatMs);
    return {
      get state() { return publicSnapshot(bundle); },
      get epoch() { return epoch; },
      get storageError() { return storageError; },
      // The world uses a separate high-frequency channel, but the accepted
      // seat lease remains its only authority. No token or lease is exposed.
      isActiveConnection(actorId, connectionId) {
        const seat = live.get(actorId);
        return !closing && !storageError && seat?.connectionId === connectionId &&
          clock.now() - seat.lastSeen < leaseMs;
      },
      invite(actorId) {
        assertSeat(actorId);
        return { sessionId, actorId, token: bundle.credentials[actorId] };
      },
      channelName(actorId) {
        assertSeat(actorId);
        return channelName(sessionId, actorId, bundle.credentials[actorId]);
      },
      // Host capability only. Call after the world validates movement/monitor
      // proximity, never with unchecked coordinates or participant claims.
      setLocation(actorId, sceneId, atScreen = false) {
        return enqueue(() => {
          commit(setLocation(bundle, actorId, sceneId, atScreen));
          publish();
          return publicSnapshot(bundle);
        });
      },
      close({ notifyClients = true } = {}) {
        if (!closePromise) {
          closing = true;
          closePromise = (async () => {
            await queue;
            if (notifyClients) for (const [id, seat] of live) send(id, seat.connectionId, 'host-down');
            cleanup();
            lock.release();
            await lock.done;
          })();
        }
        return closePromise;
      }
    };
  } catch (cause) {
    cleanup();
    lock.release();
    await lock.done;
    throw cause;
  }
}

/** One tab/seat. Keep its invitation in createResumeStore(sessionStorage, id).
 * A private channel name is a local bearer capability, not internet auth or a
 * sandbox against malicious same-origin scripts/localStorage access. An invalid
 * credential and an absent host both time out as host-unavailable; neither joins.
 */
export function createClient({ sessionId, actorId, token, channelFactory = defaultChannel,
  clock = systemClock, heartbeatMs = 1000, hostTimeoutMs = 6000, commandTimeoutMs = 15000 } = {}) {
  assertSeat(actorId);
  check(isId(sessionId) && isToken(token));
  check([heartbeatMs, hostTimeoutMs, commandTimeoutMs].every(Number.isFinite) && heartbeatMs > 0 && hostTimeoutMs > heartbeatMs && commandTimeoutMs > hostTimeoutMs);
  const connectionId = globalThis.crypto.randomUUID();
  const channel = channelFactory(channelName(sessionId, actorId, token));
  const pending = new Map();
  const listeners = new Set();
  let state = null;
  let status = 'connecting';
  let epoch = null;
  let lastSeen = clock.now();
  let closed = false;
  let storageError = null;

  function notify() {
    for (const listener of listeners) {
      try { listener(); } catch { /* consumers cannot break synchronization */ }
    }
  }
  function send(kind, extra = {}) { post(channel, { kind, connectionId, epoch, ...extra }); }
  function adopt(candidate) {
    try { validateState(candidate); } catch { return false; }
    if (candidate.id !== sessionId || (state && candidate.revision < state.revision)) return false;
    if (!state || candidate.revision > state.revision) state = structuredClone(candidate);
    return true;
  }
  function receive({ data: packet }) {
    if (closed || !isRecord(packet) || packet.connectionId !== connectionId || !isId(packet.epoch)) return;
    if (packet.kind === 'welcome') {
      if (!adopt(packet.state)) return;
      epoch = packet.epoch;
      storageError = packet.storageError === 'PERSISTENCE_FAILED' ? packet.storageError : null;
      status = storageError ? 'storage-error' : 'online';
      lastSeen = clock.now();
      for (const item of pending.values()) send('command', { command: item.command });
      notify();
      return;
    }
    if (packet.kind === 'rejected') {
      // A seat-busy response may precede our first welcome. Other responses must
      // belong to the host we joined, or to the initial connection attempt.
      if (epoch && packet.epoch !== epoch) return;
      storageError = packet.storageError === 'PERSISTENCE_FAILED' ? packet.storageError : null;
      if (packet.code === 'SEAT_BUSY') status = 'seat-busy';
      else status = storageError ? 'storage-error' : 'host-unavailable';
      notify();
      return;
    }
    if (!epoch || packet.epoch !== epoch) return;
    if (packet.kind === 'fault' && packet.storageError === 'PERSISTENCE_FAILED') {
      storageError = packet.storageError;
      status = 'storage-error';
      lastSeen = clock.now();
      notify();
      return;
    }
    if (packet.kind === 'host-down') {
      status = 'host-unavailable';
      notify();
      return;
    }
    if (packet.kind === 'snapshot' || packet.kind === 'ack') {
      if (!adopt(packet.state)) return;
      lastSeen = clock.now();
      storageError = packet.storageError === 'PERSISTENCE_FAILED' ? packet.storageError : null;
      if (status === 'online' || status === 'storage-error') status = storageError ? 'storage-error' : 'online';
      if (status === 'online' && packet.kind === 'ack') {
        const item = pending.get(packet.commandId);
        if (item && packet.result?.id === packet.commandId && packet.result.actorId === actorId && Number.isSafeInteger(packet.result.revision) && packet.result.revision <= state.revision) {
          pending.delete(packet.commandId);
          item.resolve(structuredClone(packet.result));
        }
      }
      notify();
    } else if (packet.kind === 'nack') {
      const item = pending.get(packet.commandId);
      if (!item) return;
      if (packet.code === 'NOT_CONNECTED') { status = 'host-unavailable'; notify(); return; }
      pending.delete(packet.commandId);
      item.reject(error(packet.code || 'INVALID_MESSAGE'));
    }
  }
  channel.addEventListener('message', receive);
  const timer = clock.setInterval(() => {
    if (clock.now() - lastSeen >= hostTimeoutMs && status !== 'seat-busy') status = 'host-unavailable';
    if (status === 'online') send('heartbeat');
    else send('hello');
    for (const [id, item] of pending) {
      if (clock.now() - item.startedAt >= commandTimeoutMs) {
        pending.delete(id);
        item.reject(Object.assign(error('COMMAND_OUTCOME_UNKNOWN'), { command: structuredClone(item.command) }));
      } else if (status === 'online') send('command', { command: item.command });
    }
    notify();
  }, heartbeatMs);
  send('hello');

  return {
    get connectionId() { return connectionId; },
    get state() { return state ? structuredClone(state) : null; },
    get status() { return status; },
    get storageError() { return storageError; },
    get paused() { return status !== 'online' || !state || !state.players.p0.connected || state.presentation.active || state.pauseReasons.length > 0; },
    subscribe(listener) {
      check(typeof listener === 'function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // For an uncertain outcome retry with the SAME id, expectedRevision and
    // payload. Preserve those beside the draft if the renderer reloads the tab.
    command(type, payload = {}, { id = globalThis.crypto.randomUUID(), expectedRevision = state?.revision } = {}) {
      if (closed || status !== 'online') return Promise.reject(error('HOST_UNAVAILABLE'));
      const command = { id, sessionId, expectedRevision, type, payload: structuredClone(payload) };
      if (!isId(id)) return Promise.reject(error('INVALID_PAYLOAD'));
      if (pending.has(id)) return Promise.reject(error('COMMAND_PENDING'));
      return new Promise((resolve, reject) => {
        pending.set(id, { command, resolve, reject, startedAt: clock.now() });
        send('command', { command });
      });
    },
    close({ notifyHost = true } = {}) {
      if (closed) return;
      if (notifyHost && epoch) send('goodbye');
      closed = true;
      status = 'closed';
      clock.clearInterval(timer);
      channel.removeEventListener('message', receive);
      channel.close();
      for (const item of pending.values()) item.reject(Object.assign(error('COMMAND_OUTCOME_UNKNOWN'), { command: structuredClone(item.command) }));
      pending.clear();
      notify();
      listeners.clear();
    }
  };
}
