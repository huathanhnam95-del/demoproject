// @ts-check

/**
 * Branching route generation for Echo Forge runs.
 *
 * A run is three acts. Each act is a stage with its own environment, its own
 * ordinary enemies, a small branching map, and a Warden waiting at the end of
 * it. The player routes through the branches; the Warden is the act boss.
 *
 * Everything here is a pure function of the run seed. No RNG object is ever
 * created or stored, so run state stays JSON-serializable and replay stays
 * exact.
 */

/**
 * @typedef {'fight' | 'rest' | 'cache' | 'boss'} RouteNodeType
 *
 * @typedef {Object} RouteNode
 * @property {string} id
 * @property {number} act
 * @property {number} floor
 * @property {number} index
 * @property {RouteNodeType} type
 * @property {string} name
 * @property {string | null} wardenId
 *
 * @typedef {Object} RouteFloor
 * @property {number} floor
 * @property {number} act
 * @property {readonly RouteNode[]} nodes
 *
 * @typedef {Object} Route
 * @property {string} routeVersion
 * @property {number} floorsPerAct
 * @property {readonly RouteFloor[]} floors
 * @property {readonly (readonly [string, string])[]} edges
 */

export const ROUTE_VERSION = 'echo-forge-route-v1';

/** Entry fight, two branching floors, then the act boss. */
export const FLOORS_PER_ACT = 4;

/** Minimum floors an act can be shortened to (entry + boss). */
export const MIN_FLOORS_PER_ACT = 2;

/**
 * The three acts. `colorToken` continues to feed `data-warden`, which drives
 * both the arena palette and the per-act enemy sprite treatment.
 */
export const ACTS = Object.freeze([
  Object.freeze({
    index: 0,
    stageId: 'resonant_hall',
    title: 'The Resonant Hall',
    numeral: 'I',
    colorToken: 'sentinel',
    wardenId: 'echo_sentinel',
    minion: 'Chime Wisp',
  }),
  Object.freeze({
    index: 1,
    stageId: 'cinder_forge',
    title: 'The Cinder Forge',
    numeral: 'II',
    colorToken: 'cinder',
    wardenId: 'cinder_weaver',
    minion: 'Ember Mote',
  }),
  Object.freeze({
    index: 2,
    stageId: 'void_beneath',
    title: 'The Void Beneath',
    numeral: 'III',
    colorToken: 'void',
    wardenId: 'void_singer',
    minion: 'Null Shade',
  }),
]);

export const ACT_COUNT = ACTS.length;

/** Node types a middle floor may draw from. Index 0 is always pinned to a fight. */
const MIDDLE_POOL = Object.freeze(['fight', 'rest', 'cache']);

/** Human labels for non-combat nodes. */
const NODE_LABELS = Object.freeze({
  rest: 'Quiet Alcove',
  cache: 'Sealed Cache',
});

/**
 * 32-bit avalanche hash. Same construction as `deriveRewardOffer` in rewards.js
 * and `selectWardenMove` in wardens.js, so route generation stays consistent
 * with the rest of the run layer.
 *
 * @param {number} seed
 * @param {number} floor
 * @param {number} salt
 * @returns {number}
 */
function routeHash(seed, floor, salt) {
  let hash = (Number(seed) ^ (floor * 74747) ^ (salt * 6151)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Clamp a requested floors-per-act into a supported range.
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeFloorsPerAct(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return FLOORS_PER_ACT;
  return Math.max(MIN_FLOORS_PER_ACT, Math.min(6, n));
}

/**
 * Which act a flat floor index belongs to.
 * @param {number} floor
 * @param {number} [floorsPerAct]
 * @returns {number}
 */
export function actForFloor(floor, floorsPerAct = FLOORS_PER_ACT) {
  return Math.floor(floor / floorsPerAct);
}

/**
 * Act metadata by index, clamped to the last act.
 * @param {number} actIndex
 */
export function getAct(actIndex) {
  return ACTS[actIndex] || ACTS[ACTS.length - 1];
}

/**
 * How many nodes a floor carries. Entry and boss floors are always single
 * nodes; middle floors branch into 2 or 3.
 *
 * @param {number} seed
 * @param {number} floor
 * @param {number} positionInAct
 * @param {number} floorsPerAct
 * @returns {number}
 */
function nodeCountForFloor(seed, floor, positionInAct, floorsPerAct) {
  const isEntry = positionInAct === 0;
  const isBoss = positionInAct === floorsPerAct - 1;
  if (isEntry || isBoss) return 1;
  return 2 + (routeHash(seed, floor, 0xa5) % 2);
}

/**
 * Build one floor's nodes.
 *
 * Node index 0 is pinned by position — entry and middle floors always start
 * with a fight, boss floors always hold the act's Warden. That pin is what
 * makes "always take the first node" a legal, fully deterministic path.
 *
 * @param {number} seed
 * @param {number} floor
 * @param {number} floorsPerAct
 * @returns {RouteFloor}
 */
function buildFloor(seed, floor, floorsPerAct) {
  const actIndex = actForFloor(floor, floorsPerAct);
  const act = getAct(actIndex);
  const positionInAct = floor % floorsPerAct;
  const isBoss = positionInAct === floorsPerAct - 1;
  const count = nodeCountForFloor(seed, floor, positionInAct, floorsPerAct);

  const nodes = [];
  for (let index = 0; index < count; index += 1) {
    /** @type {RouteNodeType} */
    let type;
    if (isBoss) {
      type = 'boss';
    } else if (index === 0) {
      type = 'fight';
    } else {
      type = /** @type {RouteNodeType} */ (
        MIDDLE_POOL[routeHash(seed, floor, index) % MIDDLE_POOL.length]
      );
    }

    const isCombat = type === 'fight' || type === 'boss';
    nodes.push(Object.freeze({
      id: `f${floor}n${index}`,
      act: actIndex,
      floor,
      index,
      type,
      name: type === 'boss'
        ? wardenNameFor(act.wardenId)
        : isCombat
          ? act.minion
          : NODE_LABELS[type],
      wardenId: isCombat ? act.wardenId : null,
    }));
  }

  return Object.freeze({ floor, act: actIndex, nodes: Object.freeze(nodes) });
}

/**
 * Display names for the three Wardens. Kept local rather than imported so this
 * module stays dependency-free and cheap for the storage layer to pull in.
 * @param {string} wardenId
 * @returns {string}
 */
function wardenNameFor(wardenId) {
  if (wardenId === 'echo_sentinel') return 'Echo Sentinel';
  if (wardenId === 'cinder_weaver') return 'Cinder Weaver';
  if (wardenId === 'void_singer') return 'Void Singer';
  return 'Echo Warden';
}

/**
 * Connect two adjacent floors.
 *
 * Two coverage passes run unconditionally, so every source has at least one
 * way forward and every target has at least one way in. Dead ends are
 * therefore structurally impossible rather than merely untested.
 *
 * @param {number} seed
 * @param {RouteFloor} from
 * @param {RouteFloor} to
 * @returns {[string, string][]}
 */
function buildEdgesBetween(seed, from, to) {
  const a = from.nodes.length;
  const b = to.nodes.length;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {[string, string][]} */
  const edges = [];

  const add = (sourceIndex, targetIndex) => {
    const t = Math.max(0, Math.min(b - 1, targetIndex));
    const key = `${sourceIndex}>${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([from.nodes[sourceIndex].id, to.nodes[t].id]);
  };

  // 1. Out-coverage — every source reaches something.
  //    Source 0 always maps to target 0, which is the pinned spine.
  for (let i = 0; i < a; i += 1) {
    add(i, Math.floor((i * b) / a));
  }

  // 2. In-coverage — every target is reachable from somewhere.
  const reached = new Set(edges.map(([, targetId]) => targetId));
  for (let j = 0; j < b; j += 1) {
    if (reached.has(to.nodes[j].id)) continue;
    add(Math.floor((j * a) / b), j);
  }

  // 3. Texture — at most one extra edge per source, to an adjacent target only,
  //    so paths stay readable and never sweep across the whole map.
  for (let i = 0; i < a; i += 1) {
    const roll = routeHash(seed, from.floor, 0x5c + i);
    if (roll % 3 !== 0) continue;
    const base = Math.floor((i * b) / a);
    const offset = roll % 2 === 0 ? 1 : -1;
    const target = base + offset;
    if (target < 0 || target >= b) continue;
    add(i, target);
  }

  return edges;
}

/**
 * Generate a full route. Pure: the same seed always yields the same graph.
 *
 * @param {number} seed
 * @param {{ floorsPerAct?: number }} [options]
 * @returns {Route}
 */
export function generateRoute(seed, options = {}) {
  const floorsPerAct = normalizeFloorsPerAct(options.floorsPerAct ?? FLOORS_PER_ACT);
  const totalFloors = floorsPerAct * ACT_COUNT;

  const floors = [];
  for (let floor = 0; floor < totalFloors; floor += 1) {
    floors.push(buildFloor(seed, floor, floorsPerAct));
  }

  /** @type {[string, string][]} */
  const edges = [];
  for (let floor = 0; floor < totalFloors - 1; floor += 1) {
    // Boss floors still connect forward: beating a boss leads into the next
    // act's entry floor, which keeps the graph one continuous path.
    edges.push(...buildEdgesBetween(seed, floors[floor], floors[floor + 1]));
  }

  return Object.freeze({
    routeVersion: ROUTE_VERSION,
    floorsPerAct,
    floors: Object.freeze(floors),
    edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
  });
}

/**
 * @param {Route} route
 * @param {string} nodeId
 * @returns {RouteNode | null}
 */
export function getNode(route, nodeId) {
  if (!route || !Array.isArray(route.floors)) return null;
  for (const floor of route.floors) {
    for (const node of floor.nodes) {
      if (node.id === nodeId) return node;
    }
  }
  return null;
}

/**
 * @param {Route} route
 * @param {number} floor
 * @returns {readonly RouteNode[]}
 */
export function getFloorNodes(route, floor) {
  const entry = route?.floors?.[floor];
  return entry ? entry.nodes : Object.freeze([]);
}

/**
 * Nodes reachable from `nodeId`. This is what the map offers the player, and
 * what `SELECT_NODE` validates against.
 *
 * @param {Route} route
 * @param {string} nodeId
 * @returns {readonly string[]}
 */
export function getSuccessorIds(route, nodeId) {
  if (!route || !Array.isArray(route.edges)) return Object.freeze([]);
  const out = [];
  for (const [from, to] of route.edges) {
    if (from === nodeId) out.push(to);
  }
  return Object.freeze(out);
}

/**
 * The single place fight difficulty is decided.
 *
 * Scales progressively across acts, with escalating minion and Warden boss stat blocks:
 * - Act 0 (Resonant Hall): Minion 90 HP / 15 DMG; Boss (Echo Sentinel) 120 HP / 20 DMG
 * - Act 1 (Cinder Forge):  Minion 110 HP / 18 DMG; Boss (Cinder Weaver) 140 HP / 22 DMG
 * - Act 2 (Void Beneath):  Minion 130 HP / 20 DMG; Boss (Void Singer) 160 HP / 25 DMG
 *
 * @param {RouteNode} node
 * @returns {{ maxHp: number, baseDamage: number, moveSetId: string }}
 */
export function nodeCombatProfile(node) {
  const act = Number.isInteger(node?.act) ? Math.max(0, Math.min(2, node.act)) : 0;
  const isBoss = node?.type === 'boss';

  if (act === 0) {
    return isBoss
      ? { maxHp: 120, baseDamage: 20, moveSetId: 'sentinel' }
      : { maxHp: 90, baseDamage: 15, moveSetId: 'baseline' };
  }
  if (act === 1) {
    return isBoss
      ? { maxHp: 140, baseDamage: 22, moveSetId: 'cinder' }
      : { maxHp: 110, baseDamage: 18, moveSetId: 'baseline' };
  }
  return isBoss
    ? { maxHp: 160, baseDamage: 25, moveSetId: 'void' }
    : { maxHp: 130, baseDamage: 20, moveSetId: 'baseline' };
}

/**
 * @param {RouteNodeType} type
 * @returns {boolean}
 */
export function isCombatNode(type) {
  return type === 'fight' || type === 'boss';
}

/**
 * Structural check used by `validateRunState` and the route tests.
 * @param {any} route
 * @returns {boolean}
 */
export function validateRoute(route) {
  if (!route || typeof route !== 'object') return false;
  if (route.routeVersion !== ROUTE_VERSION) return false;
  if (!Array.isArray(route.floors) || route.floors.length < ACT_COUNT * MIN_FLOORS_PER_ACT) return false;
  if (!Array.isArray(route.edges)) return false;

  const floorsPerAct = route.floorsPerAct;
  if (!Number.isInteger(floorsPerAct) || floorsPerAct < MIN_FLOORS_PER_ACT) return false;
  if (route.floors.length !== floorsPerAct * ACT_COUNT) return false;

  const ids = new Set();
  for (let floor = 0; floor < route.floors.length; floor += 1) {
    const entry = route.floors[floor];
    if (!entry || entry.floor !== floor) return false;
    if (!Array.isArray(entry.nodes) || entry.nodes.length === 0) return false;

    const positionInAct = floor % floorsPerAct;
    const isBossFloor = positionInAct === floorsPerAct - 1;
    if ((positionInAct === 0 || isBossFloor) && entry.nodes.length !== 1) return false;

    for (let index = 0; index < entry.nodes.length; index += 1) {
      const node = entry.nodes[index];
      if (!node || node.id !== `f${floor}n${index}`) return false;
      if (ids.has(node.id)) return false;
      ids.add(node.id);
      if (node.floor !== floor || node.index !== index) return false;
      if (isBossFloor && node.type !== 'boss') return false;
      if (!isBossFloor && node.type === 'boss') return false;
      if (positionInAct === 0 && node.type !== 'fight') return false;
    }
  }

  for (const edge of route.edges) {
    if (!Array.isArray(edge) || edge.length !== 2) return false;
    if (!ids.has(edge[0]) || !ids.has(edge[1])) return false;
  }

  return true;
}
