import { SEATS, SCENES, PRESENTATION_ROOMS, assertSeat, locationFor, presentationReadiness, check, fail } from './progression.mjs';

const MAX_RECEIPTS = 10000;
const MAX_PAGES = 100;
const MAX_PAGE_IDS = 1000;
const COMMANDS = ['profile.set', 'notes.save', 'notes.delete', 'player.ready', 'session.pause', 'session.resume', 'presentation.open', 'presentation.close'];
const PRESENTER_COMMANDS = COMMANDS.slice(4);
export const isId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
export const isToken = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(value);
const isVersion = value => Number.isSafeInteger(value) && value >= 0;
const isText = (value, max) => typeof value === 'string' && value.length <= max;
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function keys(value, allowed, required = allowed) {
  check(isRecord(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)));
}

function appearance(value, partial = false) {
  keys(value, ['hat', 'glasses', 'shirt'], partial ? [] : undefined);
  if (Object.hasOwn(value, 'hat')) check(isText(value.hat, 32) && value.hat.length > 0);
  if (Object.hasOwn(value, 'shirt')) check(isText(value.shirt, 32) && value.shirt.length > 0);
  if (Object.hasOwn(value, 'glasses')) check(typeof value.glasses === 'boolean');
}

function validateCommand(command) {
  keys(command, ['id', 'sessionId', 'expectedRevision', 'type', 'payload']);
  check(isId(command.id) && isId(command.sessionId) && isVersion(command.expectedRevision));
  check(COMMANDS.includes(command.type), 'INVALID_COMMAND');
  const p = command.payload;
  switch (command.type) {
    case 'profile.set':
      keys(p, ['name', 'appearance'], []);
      check(Object.keys(p).length > 0);
      if (Object.hasOwn(p, 'name')) check(isText(p.name, 80) && p.name.trim().length > 0);
      if (Object.hasOwn(p, 'appearance')) appearance(p.appearance, true);
      break;
    case 'notes.save':
      keys(p, ['pageId', 'title', 'body', 'expectedVersion']);
      check(isText(p.title, 200) && isText(p.body, 50000));
      check(isId(p.pageId) && isVersion(p.expectedVersion));
      break;
    case 'notes.delete':
      keys(p, ['pageId', 'expectedVersion']);
      check(isId(p.pageId) && isVersion(p.expectedVersion));
      break;
    case 'player.ready':
      keys(p, ['sceneId', 'instanceId', 'loadRevision']);
      check(SCENES.includes(p.sceneId) && isId(p.instanceId) && isVersion(p.loadRevision));
      check(p.sceneId === 'home' ? /^home:p[1-3]$/.test(p.instanceId) : p.instanceId === p.sceneId);
      break;
    case 'presentation.open':
      keys(p, ['roomId']);
      check(PRESENTATION_ROOMS.includes(p.roomId), 'INVALID_ROOM');
      break;
    default: keys(p, []);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateState(state) {
  keys(state, ['schemaVersion', 'id', 'brand', 'revision', 'players', 'pauseReasons', 'presentation']);
  check(state.schemaVersion === 1 && isId(state.id) && state.brand === 'Better English Learning' && isVersion(state.revision));
  keys(state.players, SEATS);
  for (const id of SEATS) {
    const p = state.players[id];
    keys(p, ['id', 'role', 'gender', 'name', 'appearance', 'location', 'connected', 'ready', 'loadRevision', 'notes', 'noteVersions']);
    check(p.id === id && p.role === (id === 'p0' ? 'presenter' : 'participant') && p.gender === (id === 'p0' ? 'male' : 'female'));
    check(isText(p.name, 80) && p.name.trim().length > 0);
    appearance(p.appearance);
    keys(p.location, ['sceneId', 'instanceId', 'atScreen']);
    check(canonical(p.location) === canonical(locationFor(id, p.location.sceneId, p.location.atScreen)));
    check(typeof p.connected === 'boolean' && typeof p.ready === 'boolean' && (!p.ready || p.connected));
    check(isVersion(p.loadRevision) && p.loadRevision <= state.revision);
    check(!p.location.atScreen || p.connected);
    check(Array.isArray(p.notes) && p.notes.length <= MAX_PAGES && isRecord(p.noteVersions));
    check(Object.keys(p.noteVersions).length <= MAX_PAGE_IDS);
    for (const [pageId, version] of Object.entries(p.noteVersions)) check(isId(pageId) && isVersion(version) && version > 0);
    const ids = new Set();
    for (const page of p.notes) {
      keys(page, ['id', 'title', 'body', 'version', 'updatedAt']);
      check(isId(page.id) && !ids.has(page.id) && isText(page.title, 200) && isText(page.body, 50000));
      check(isVersion(page.version) && page.version > 0 && p.noteVersions[page.id] === page.version && isVersion(page.updatedAt));
      ids.add(page.id);
    }
  }
  check(Array.isArray(state.pauseReasons) && new Set(state.pauseReasons).size === state.pauseReasons.length);
  check(state.pauseReasons.every(reason => ['presenter', 'recovery', 'group'].includes(reason)));
  keys(state.presentation, ['active', 'roomId']);
  check(typeof state.presentation.active === 'boolean');
  check(state.presentation.active ? PRESENTATION_ROOMS.includes(state.presentation.roomId) : state.presentation.roomId === null);
  const groupPaused = state.presentation.active && !presentationReadiness(state, state.presentation.roomId).ready;
  check(state.pauseReasons.includes('group') === groupPaused);
  return state;
}

export function validateBundle(bundle) {
  keys(bundle, ['schemaVersion', 'state', 'credentials', 'receipts']);
  check(bundle.schemaVersion === 1);
  validateState(bundle.state);
  keys(bundle.credentials, SEATS);
  check(SEATS.every(id => isToken(bundle.credentials[id])) && new Set(Object.values(bundle.credentials)).size === 4);
  check(Array.isArray(bundle.receipts) && bundle.receipts.length <= MAX_RECEIPTS);
  const ids = new Set();
  let previousRevision = 0;
  for (const receipt of bundle.receipts) {
    keys(receipt, ['actorId', 'command', 'result']);
    assertSeat(receipt.actorId);
    validateCommand(receipt.command);
    keys(receipt.result, ['id', 'actorId', 'revision']);
    const key = `${receipt.actorId}/${receipt.command.id}`;
    check(!ids.has(key) && receipt.command.sessionId === bundle.state.id);
    check(receipt.result.id === receipt.command.id && receipt.result.actorId === receipt.actorId);
    check(isVersion(receipt.result.revision) && receipt.result.revision > previousRevision && receipt.result.revision <= bundle.state.revision);
    check(receipt.command.expectedRevision < receipt.result.revision);
    check(!PRESENTER_COMMANDS.includes(receipt.command.type) || receipt.actorId === 'p0');
    if (receipt.command.type === 'player.ready') {
      check(receipt.command.payload.loadRevision < receipt.result.revision);
      check(receipt.command.payload.instanceId === locationFor(receipt.actorId, receipt.command.payload.sceneId).instanceId);
    }
    previousRevision = receipt.result.revision;
    ids.add(key);
  }
  return bundle;
}

export function createSession({ id, tokenFactory = () => globalThis.crypto.randomUUID() } = {}) {
  check(isId(id));
  const players = Object.fromEntries(SEATS.map((actorId, index) => [actorId, {
    id: actorId, role: index === 0 ? 'presenter' : 'participant', gender: index === 0 ? 'male' : 'female',
    name: index === 0 ? 'Presenter' : `Participant ${index}`,
    appearance: { hat: 'none', glasses: false, shirt: 'default' },
    location: locationFor(actorId, index === 0 ? 'reception' : 'home'),
    connected: false, ready: false, loadRevision: 0, notes: [], noteVersions: {}
  }]));
  return validateBundle({ schemaVersion: 1,
    state: { schemaVersion: 1, id, brand: 'Better English Learning', revision: 0, players, pauseReasons: [], presentation: { active: false, roomId: null } },
    credentials: Object.fromEntries(SEATS.map(actorId => [actorId, tokenFactory()])), receipts: [] });
}

export function publicSnapshot(bundle) {
  // Explicitly copy only the validated public projection, never spread a bundle.
  validateState(bundle.state);
  return structuredClone(bundle.state);
}

function changed(bundle) {
  check(bundle.state.revision < Number.MAX_SAFE_INTEGER, 'REVISION_EXHAUSTED');
  bundle.state.revision += 1;
  const { state } = bundle;
  state.pauseReasons = state.pauseReasons.filter(reason => reason !== 'group');
  if (state.presentation.active && !presentationReadiness(state, state.presentation.roomId).ready) state.pauseReasons.push('group');
  return bundle;
}

// Trusted host/world functions. Never dispatch these from unvalidated client input.
export function setLocation(bundle, actorId, sceneId, atScreen = false) {
  const location = locationFor(actorId, sceneId, atScreen);
  check(!atScreen || bundle.state.players[actorId].connected, 'NOT_CONNECTED');
  const next = structuredClone(bundle);
  const player = next.state.players[actorId];
  if (canonical(player.location) === canonical(location)) return bundle;
  if (player.location.instanceId !== location.instanceId) {
    player.ready = false;
    player.loadRevision = bundle.state.revision + 1;
  }
  player.location = location;
  return changed(next);
}

export function setPresence(bundle, actorId, connected) {
  assertSeat(actorId);
  check(typeof connected === 'boolean');
  if (bundle.state.players[actorId].connected === connected) return bundle;
  const next = structuredClone(bundle);
  const player = next.state.players[actorId];
  player.connected = connected;
  player.ready = false;
  player.loadRevision = bundle.state.revision + 1;
  if (!connected) player.location.atScreen = false;
  return changed(next);
}

export function recoverSession(bundle) {
  const next = structuredClone(validateBundle(bundle));
  for (const player of Object.values(next.state.players)) {
    player.connected = false;
    player.ready = false;
    player.loadRevision = bundle.state.revision + 1;
    player.location.atScreen = false;
  }
  if (!next.state.pauseReasons.includes('recovery')) next.state.pauseReasons.push('recovery');
  return changed(next);
}

// Pure transaction: callers must durably save the returned bundle before adopting
// it or returning its receipt. expectedRevision is a causal ceiling, not a global
// compare-and-swap for independent edits; notes carry their own page versions.
export function applyCommand(bundle, actorId, command, now = Date.now()) {
  assertSeat(actorId);
  validateCommand(command);
  check(command.sessionId === bundle.state.id, 'WRONG_SESSION');
  if (PRESENTER_COMMANDS.includes(command.type)) check(actorId === 'p0', 'FORBIDDEN');
  const receipt = bundle.receipts.find(item => item.actorId === actorId && item.command.id === command.id);
  if (receipt) {
    check(canonical(receipt.command) === canonical(command), 'COMMAND_ID_REUSED');
    return { bundle, result: structuredClone(receipt.result) };
  }
  check(command.expectedRevision <= bundle.state.revision, 'STALE_REVISION');
  check(bundle.receipts.length < MAX_RECEIPTS, 'HISTORY_FULL');
  check(isVersion(now));
  const next = structuredClone(bundle);
  const { state } = next;
  const player = state.players[actorId];
  const p = command.payload;
  switch (command.type) {
    case 'profile.set':
      if (Object.hasOwn(p, 'name')) player.name = p.name.trim();
      if (p.appearance) Object.assign(player.appearance, p.appearance);
      break;
    case 'notes.save':
    case 'notes.delete': {
      const version = Object.hasOwn(player.noteVersions, p.pageId) ? player.noteVersions[p.pageId] : 0;
      const index = player.notes.findIndex(page => page.id === p.pageId);
      check(p.expectedVersion === version && (command.type !== 'notes.delete' || index !== -1), 'NOTE_CONFLICT');
      check(version < Number.MAX_SAFE_INTEGER, 'REVISION_EXHAUSTED');
      check(version > 0 || Object.keys(player.noteVersions).length < MAX_PAGE_IDS, 'NOTE_LIMIT');
      player.noteVersions[p.pageId] = version + 1;
      if (command.type === 'notes.delete') player.notes.splice(index, 1);
      else {
        const page = { id: p.pageId, title: p.title, body: p.body, version: version + 1, updatedAt: now };
        if (index === -1) {
          check(player.notes.length < MAX_PAGES, 'NOTE_LIMIT');
          player.notes.push(page);
        } else player.notes[index] = page;
      }
      break;
    }
    case 'player.ready':
      check(player.connected, 'NOT_CONNECTED');
      check(player.location.sceneId === p.sceneId && player.location.instanceId === p.instanceId, 'WRONG_ROOM');
      check(player.loadRevision === p.loadRevision, 'STALE_LOAD');
      player.ready = true;
      break;
    case 'session.pause':
      if (!state.pauseReasons.includes('presenter')) state.pauseReasons.push('presenter');
      break;
    case 'session.resume':
      state.pauseReasons = state.pauseReasons.filter(reason => !['presenter', 'recovery'].includes(reason));
      break;
    case 'presentation.open': {
      check(state.pauseReasons.length === 0, 'SESSION_PAUSED');
      const readiness = presentationReadiness(state, p.roomId);
      check(readiness.missing.length === 0, 'GROUP_NOT_READY');
      check(readiness.atScreen, 'NOT_AT_SCREEN');
      state.presentation = { active: true, roomId: p.roomId };
      break;
    }
    case 'presentation.close': state.presentation = { active: false, roomId: null }; break;
    default: fail('INVALID_COMMAND');
  }
  changed(next);
  const result = { id: command.id, actorId, revision: state.revision };
  next.receipts.push({ actorId, command: structuredClone(command), result: structuredClone(result) });
  return { bundle: next, result };
}
