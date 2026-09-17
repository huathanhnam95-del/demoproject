// Scoped content disclosure selectors for BEL Working as Equals (Phase 04 / P04.1)
// Authoritative disclosure functions mapping simulation state to readable content.
// Strictly prevents premature revelation of unearned sections or objectives.

import { HEADINGS, GROUPS } from './source.mjs';
import { PHASES, PLANKS } from '../activities/bridge.mjs';

/**
 * Returns disclosed sections for a specific B route (B1, B2, B3).
 * If unplaced, text is null and placed is false.
 */
export function getDisclosedRouteSections(world, route, source) {
  if (!world?.routes || !world.routes[route] || !source?.routes?.[route]) {
    return null;
  }
  const routeState = world.routes[route];
  const routeSource = source.routes[route];

  return routeState.map((shape, index) => {
    const isPlaced = Boolean(shape.placed);
    return {
      index,
      heading: HEADINGS[index] || '',
      placed: isPlaced,
      title: routeSource.title,
      slide: routeSource.slide,
      route,
      text: isPlaced ? routeSource.sections[index] : null
    };
  });
}

/**
 * Returns disclosed gallery portrait information by index (0-4).
 */
export function getDisclosedPortrait(index, source) {
  if (!source?.gallery || !source.gallery[index]) {
    return null;
  }
  const entry = source.gallery[index];
  return {
    index,
    name: entry.name,
    slide: entry.slide,
    image: entry.image,
    quote: entry.quote,
    paragraphs: entry.paragraphs,
    attribution: entry.attribution
  };
}

/**
 * Returns disclosed bridge review phases (0-3 phases depending on placed planks).
 * Planks placed count / 2 determines how many review pairs are earned.
 */
export function getDisclosedBridgeReview(world) {
  if (!world?.bridge) return [];
  const count = Math.min(3, Math.floor((world.bridge.placed || 0) / 2));
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({
      index: i,
      phase: PHASES[i],
      planks: [
        {
          index: i * 2,
          color: PLANKS[i * 2][0],
          mark: PLANKS[i * 2][1],
          text: PLANKS[i * 2][2]
        },
        {
          index: i * 2 + 1,
          color: PLANKS[i * 2 + 1][0],
          mark: PLANKS[i * 2 + 1][1],
          text: PLANKS[i * 2 + 1][2]
        }
      ]
    });
  }
  return result;
}

/**
 * Returns disclosed Room J objectives based on matched pairs.
 */
export function getDisclosedObjectives(world, source) {
  if (!world?.cubes?.pairs || !source?.objectives) return [];
  return world.cubes.pairs.map((matched, i) => {
    const obj = source.objectives[i];
    const isMatched = Boolean(matched);
    return {
      index: i,
      matched: isMatched,
      title: obj ? obj.title : `Objective ${i + 1}`,
      detail: isMatched && obj ? obj.detail : null
    };
  });
}

/**
 * Verifies whether a shared presentation can be legally started in the given room.
 */
export function canStartPresentation(world, session, roomId, actorId = 'p0') {
  if (actorId !== 'p0') {
    return { allowed: false, reason: 'Only the presenter can start a presentation.' };
  }
  if (!GROUPS[roomId]) {
    return { allowed: false, reason: `Room ${roomId} is not a designated presentation room.` };
  }
  if (!session?.players || !world?.players) {
    return { allowed: false, reason: 'Session or world state unavailable.' };
  }

  const players = Object.values(session.players);
  const missing = players.filter(p => !p.connected || !p.ready || world.players[p.id]?.scene !== roomId);
  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `Waiting for: ${missing.map(p => p.name).join(', ')}`,
      missingPlayers: missing.map(p => p.name)
    };
  }

  if (roomId === 'J') {
    const pairsDone = world.cubes?.pairs?.every(Boolean);
    if (!pairsDone) {
      return {
        allowed: false,
        reason: 'All three cube matches must be completed before starting the final presentation.'
      };
    }
  }

  return { allowed: true };
}
