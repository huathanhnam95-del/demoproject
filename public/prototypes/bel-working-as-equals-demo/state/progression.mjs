// World identity/readiness only. Geometry, collision and activity unlocks belong to
// the future authoritative world adapter; these helpers cannot prove proximity.
export const SEATS = Object.freeze(['p0', 'p1', 'p2', 'p3']);
export const SCENES = Object.freeze(['home', 'street', 'reception', 'A', 'B1', 'B2', 'B3', 'C', 'D', 'E', 'F', 'G', 'I', 'J']);
export const PRESENTATION_ROOMS = Object.freeze(['A', 'C', 'E', 'G', 'I', 'J']);

export function fail(code, message = code) {
  throw Object.assign(new Error(message), { code });
}

export function check(condition, code = 'INVALID_PAYLOAD') {
  if (!condition) fail(code);
}

export function assertSeat(actorId) {
  check(SEATS.includes(actorId), 'INVALID_ACTOR');
}

export function locationFor(actorId, sceneId, atScreen = false) {
  assertSeat(actorId);
  check(SCENES.includes(sceneId) && (sceneId !== 'home' || actorId !== 'p0'), 'INVALID_ROOM');
  check(typeof atScreen === 'boolean', 'INVALID_LOCATION');
  check(!atScreen || (actorId === 'p0' && PRESENTATION_ROOMS.includes(sceneId)), 'INVALID_LOCATION');
  return { sceneId, instanceId: sceneId === 'home' ? `home:${actorId}` : sceneId, atScreen };
}

export function presentationReadiness(state, roomId) {
  check(PRESENTATION_ROOMS.includes(roomId), 'INVALID_ROOM');
  const missing = SEATS.filter(id => {
    const player = state.players[id];
    return !player.connected || !player.ready || player.location.sceneId !== roomId || player.location.instanceId !== roomId;
  });
  const presenter = state.players.p0;
  const atScreen = presenter.location.sceneId === roomId && presenter.location.instanceId === roomId && presenter.location.atScreen;
  return { roomId, missing, atScreen, ready: missing.length === 0 && atScreen };
}
