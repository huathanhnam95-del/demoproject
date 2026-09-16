// Semantic identities copied from the reviewed baseline, commit
// 249a8fc86b5a293f82008b0db07c64aeca4ad2bd, feature root
// public/prototypes/bel-working-as-equals-demo/. Data only: no teaching text,
// no answer order hints, no side effects. tools/check-source-identity.mjs
// re-reads the baseline and fails if any value here drifts from it.

// activities/bridge.mjs PLANKS[index] = [color, mark, text, x, y].
// The plank text is deliberately NOT copied: it is disclosed by the
// application's screen-space label only when inspected/carried.
export const PLANK_IDENTITIES = Object.freeze([
  Object.freeze({ id: 'plank-0', index: 0, color: 'teal', mark: 'diamond' }),
  Object.freeze({ id: 'plank-1', index: 1, color: 'violet', mark: 'two bars' }),
  Object.freeze({ id: 'plank-2', index: 2, color: 'rose', mark: 'star' }),
  Object.freeze({ id: 'plank-3', index: 3, color: 'red', mark: 'circle' }),
  Object.freeze({ id: 'plank-4', index: 4, color: 'blue', mark: 'cross' }),
  Object.freeze({ id: 'plank-5', index: 5, color: 'amber', mark: 'triangle' })
]);

// activities/cubes.mjs CUBES[index] = [color, mark, text, pair, x, y].
// The words and the pair index are deliberately NOT copied: the pairing is the
// answer, and it must never be inferable from the model.
export const CUBE_IDENTITIES = Object.freeze([
  Object.freeze({ id: 'cube-0', index: 0, color: 'teal', mark: 'diamond' }),
  Object.freeze({ id: 'cube-1', index: 1, color: 'red', mark: 'circle' }),
  Object.freeze({ id: 'cube-2', index: 2, color: 'amber', mark: 'triangle' }),
  Object.freeze({ id: 'cube-3', index: 3, color: 'blue', mark: 'cross' }),
  Object.freeze({ id: 'cube-4', index: 4, color: 'violet', mark: 'two bars' }),
  Object.freeze({ id: 'cube-5', index: 5, color: 'rose', mark: 'star' })
]);

// world/scenes.mjs SHAPES, used by the B1/B2/B3 reflection routes.
export const ROUTE_SHAPES = Object.freeze(['triangle', 'square', 'circle']);

// activities/reversal.mjs choiceAt(): the authoritative choice regions.
// The painted 2D rectangle is a few pixels larger; the model follows the
// logical boundary so the floor never promises a choice it will not accept.
export const CHOICE_REGIONS = Object.freeze([
  Object.freeze({ id: 'do', label: 'Do', logical: Object.freeze({ x0: 135, x1: 420, y0: 195, y1: 361 }) }),
  Object.freeze({ id: 'dont', label: "Don't", logical: Object.freeze({ x0: 581, x1: 866, y0: 195, y1: 361 }) })
]);

// world/simulation.mjs: the two ridable objects that exist in Home, their
// parked solids (x-28, 352, 56 x 14) and their ride targets. Nothing else is
// ridable, and the pack adds no vehicle the host does not already have.
export const RIDE_IDENTITIES = Object.freeze([
  Object.freeze({ id: 'scooter', targetLogical: Object.freeze({ x: 380, y: 365 }), parkedLogical: Object.freeze({ x: 352, y: 352, w: 56, h: 14 }) }),
  Object.freeze({ id: 'skateboard', targetLogical: Object.freeze({ x: 622, y: 365 }), parkedLogical: Object.freeze({ x: 594, y: 352, w: 56, h: 14 }) })
]);

// world/simulation.mjs carsAt(): the street traffic. Position is a function of
// the clock and belongs to the host; only the two bodies are modelled.
export const CAR_VARIANTS = Object.freeze([
  Object.freeze({ id: 'car-0', index: 0, color: '#b65339', widthLogical: 128, depthLogical: 43, laneLogicalY: 207, direction: -1 }),
  Object.freeze({ id: 'car-1', index: 1, color: '#3475ad', widthLogical: 142, depthLogical: 45, laneLogicalY: 280, direction: 1 })
]);

// world/simulation.mjs social actions. Data only: the greeting has no wording
// here (the host draws the name label), and holding hands is a host relation.
export const SOCIAL = Object.freeze({
  waveMs: 2200,                 // act(): p.waveUntil = now + 2200
  holdGapLogical: 32,           // the pair is re-anchored at { x: p.x + 32, y: p.y }
  holdFollowMinLogical: 31,     // the follower closes until it is 31 px away
  holdBreakLogical: 62          // beyond 62 px the leader stops instead of dragging
});

// ui/panels.mjs profile form options; state/session.mjs default
// appearance is { hat: 'none', glasses: false, shirt: 'default' }.
export const APPEARANCE_OPTIONS = Object.freeze({
  shirt: Object.freeze(['teal', 'cream', 'amber', 'red']),
  hat: Object.freeze(['none', 'straw', 'cap']),
  glasses: Object.freeze([false, true])
});
export const DEFAULT_APPEARANCE = Object.freeze({ hat: 'none', glasses: false, shirt: 'default' });

// Seats p0..p3: p0 is the presenter (gender 'male'); p1..p3 are participants
// ('female'), per state/session.mjs. Base looks follow the approved cast
// sprites (world/sprites.mjs createSpriteAtlas specs).
export const ACTORS = Object.freeze(['p0', 'p1', 'p2', 'p3']);

// Mirrors world/sprites.mjs: an unknown shirt value leaves the original
// clothing (no tint); only 'cap' and 'straw' draw a hat; glasses are truthy.
export function resolveAppearance(appearance = {}) {
  const shirt = APPEARANCE_OPTIONS.shirt.includes(appearance.shirt) ? appearance.shirt : 'default';
  const hat = appearance.hat === 'cap' || appearance.hat === 'straw' ? appearance.hat : 'none';
  return { shirt, hat, glasses: Boolean(appearance.glasses) };
}
