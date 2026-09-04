import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTS,
  ACT_COUNT,
  FLOORS_PER_ACT,
  MIN_FLOORS_PER_ACT,
  ROUTE_VERSION,
  actForFloor,
  generateRoute,
  getFloorNodes,
  getNode,
  getSuccessorIds,
  isCombatNode,
  nodeCombatProfile,
  normalizeFloorsPerAct,
  validateRoute,
} from '../../public/js/echo-forge/core/route.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => (0x4543484f + i * 2654435761) >>> 0);

test('route generation is pure and deterministic', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    assert.deepEqual(generateRoute(seed), generateRoute(seed), `seed ${seed} is stable`);
  }
});

test('route is JSON round-trippable and deeply frozen', () => {
  const route = generateRoute(0x4543484f);
  assert.deepEqual(JSON.parse(JSON.stringify(route)), route, 'no RNG object leaked into the route');
  assert.ok(Object.isFrozen(route), 'route frozen');
  assert.ok(Object.isFrozen(route.floors), 'floors frozen');
  assert.ok(Object.isFrozen(route.floors[1]), 'floor frozen');
  assert.ok(Object.isFrozen(route.floors[1].nodes), 'nodes frozen');
  assert.ok(Object.isFrozen(route.floors[1].nodes[0]), 'node frozen');
});

test('the pinned spine holds for every seed', () => {
  for (const seed of SEEDS) {
    const route = generateRoute(seed);

    // Node 0 of every floor is pinned by position: entry and middle floors
    // open with a fight, boss floors hold the act Warden.
    for (let floor = 0; floor < route.floors.length; floor += 1) {
      const positionInAct = floor % route.floorsPerAct;
      const isBossFloor = positionInAct === route.floorsPerAct - 1;
      const first = route.floors[floor].nodes[0];
      assert.equal(
        first.type,
        isBossFloor ? 'boss' : 'fight',
        `seed ${seed} floor ${floor} node 0 type`,
      );
    }

    // ...and the spine edge always exists, so "always take the first node" is
    // always a legal path.
    for (let floor = 0; floor < route.floors.length - 1; floor += 1) {
      const successors = getSuccessorIds(route, `f${floor}n0`);
      assert.ok(
        successors.includes(`f${floor + 1}n0`),
        `seed ${seed}: spine edge f${floor}n0 -> f${floor + 1}n0 missing`,
      );
    }
  }
});

test('every node has at least one way in and one way out', () => {
  for (const seed of SEEDS) {
    const route = generateRoute(seed);
    const lastFloor = route.floors.length - 1;

    const outgoing = new Set(route.edges.map(([from]) => from));
    const incoming = new Set(route.edges.map(([, to]) => to));

    for (const floor of route.floors) {
      for (const node of floor.nodes) {
        if (floor.floor < lastFloor) {
          assert.ok(outgoing.has(node.id), `seed ${seed}: ${node.id} is a dead end`);
        }
        if (floor.floor > 0) {
          assert.ok(incoming.has(node.id), `seed ${seed}: ${node.id} is unreachable`);
        }
      }
    }
  }
});

test('each act ends in exactly one boss and starts with one entry fight', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const route = generateRoute(seed);
    const bossFloors = [];

    for (const floor of route.floors) {
      const bosses = floor.nodes.filter((node) => node.type === 'boss');
      if (bosses.length === 0) continue;
      assert.equal(bosses.length, 1, `seed ${seed} floor ${floor.floor} has one boss`);
      assert.equal(floor.nodes.length, 1, 'boss floors are single-node');
      bossFloors.push(floor.floor);
    }

    assert.equal(bossFloors.length, ACT_COUNT, `seed ${seed} has one boss per act`);

    for (let act = 0; act < ACT_COUNT; act += 1) {
      const entryFloor = act * route.floorsPerAct;
      const bossFloor = entryFloor + route.floorsPerAct - 1;
      assert.ok(bossFloors.includes(bossFloor), `act ${act} boss is on its last floor`);

      const entry = route.floors[entryFloor];
      assert.equal(entry.nodes.length, 1, `act ${act} entry is single-node`);
      assert.equal(entry.nodes[0].type, 'fight', `act ${act} entry is a fight`);
    }
  }
});

test('bosses are the act Wardens, in order', () => {
  const route = generateRoute(0x4543484f);
  const bossNames = route.floors
    .flatMap((floor) => floor.nodes)
    .filter((node) => node.type === 'boss')
    .map((node) => node.name);

  assert.deepEqual(bossNames, ['Echo Sentinel', 'Cinder Weaver', 'Void Singer']);

  const bossWardenIds = route.floors
    .flatMap((floor) => floor.nodes)
    .filter((node) => node.type === 'boss')
    .map((node) => node.wardenId);

  assert.deepEqual(bossWardenIds, ['echo_sentinel', 'cinder_weaver', 'void_singer']);
});

test('ordinary fights carry their act minion name and Warden theme', () => {
  const route = generateRoute(0x4543484f);
  for (const floor of route.floors) {
    for (const node of floor.nodes) {
      const act = ACTS[node.act];
      if (node.type === 'fight') {
        assert.equal(node.name, act.minion, `${node.id} uses the act minion name`);
        assert.equal(node.wardenId, act.wardenId, `${node.id} keeps the act theme`);
      }
      if (!isCombatNode(node.type)) {
        assert.equal(node.wardenId, null, `${node.id} is non-combat`);
      }
    }
  }
});

test('node ids are unique and positional', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const route = generateRoute(seed);
    const ids = new Set();
    for (const floor of route.floors) {
      floor.nodes.forEach((node, index) => {
        assert.equal(node.id, `f${floor.floor}n${index}`);
        assert.equal(node.floor, floor.floor);
        assert.equal(node.index, index);
        assert.equal(node.act, actForFloor(floor.floor, route.floorsPerAct));
        assert.ok(!ids.has(node.id), `duplicate id ${node.id}`);
        ids.add(node.id);
      });
    }
  }
});

test('middle floors branch into two or three nodes', () => {
  let sawTwo = false;
  let sawThree = false;
  for (const seed of SEEDS) {
    const route = generateRoute(seed);
    for (const floor of route.floors) {
      const positionInAct = floor.floor % route.floorsPerAct;
      const isEdgeFloor = positionInAct === 0 || positionInAct === route.floorsPerAct - 1;
      if (isEdgeFloor) continue;
      assert.ok(
        floor.nodes.length === 2 || floor.nodes.length === 3,
        `floor ${floor.floor} branches into 2 or 3`,
      );
      if (floor.nodes.length === 2) sawTwo = true;
      if (floor.nodes.length === 3) sawThree = true;
    }
  }
  assert.ok(sawTwo && sawThree, 'both branch widths occur across seeds');
});

test('all fights share one profile while difficulty tuning is deferred', () => {
  const route = generateRoute(0x4543484f);
  const combat = route.floors
    .flatMap((floor) => floor.nodes)
    .filter((node) => isCombatNode(node.type));

  assert.ok(combat.length > 0);
  for (const node of combat) {
    assert.deepEqual(nodeCombatProfile(node), {
      maxHp: 120,
      baseDamage: 20,
      moveSetId: 'baseline',
    }, `${node.id} uses the shared stat block`);
  }
});

test('floorsPerAct can be shortened for tests', () => {
  const route = generateRoute(0x4543484f, { floorsPerAct: 2 });
  assert.equal(route.floorsPerAct, 2);
  assert.equal(route.floors.length, 2 * ACT_COUNT);
  assert.ok(validateRoute(route));

  // Entry fight then boss, three times over.
  const types = route.floors.map((floor) => floor.nodes[0].type);
  assert.deepEqual(types, ['fight', 'boss', 'fight', 'boss', 'fight', 'boss']);
});

test('normalizeFloorsPerAct clamps hostile input', () => {
  assert.equal(normalizeFloorsPerAct(undefined), FLOORS_PER_ACT);
  assert.equal(normalizeFloorsPerAct('nope'), FLOORS_PER_ACT);
  assert.equal(normalizeFloorsPerAct(1.5), FLOORS_PER_ACT);
  assert.equal(normalizeFloorsPerAct(0), MIN_FLOORS_PER_ACT);
  assert.equal(normalizeFloorsPerAct(-4), MIN_FLOORS_PER_ACT);
  assert.equal(normalizeFloorsPerAct(999), 6);
  assert.equal(normalizeFloorsPerAct(3), 3);
});

test('lookup helpers behave', () => {
  const route = generateRoute(0x4543484f);
  assert.equal(getNode(route, 'f0n0').id, 'f0n0');
  assert.equal(getNode(route, 'nope'), null);
  assert.equal(getNode(null, 'f0n0'), null);
  assert.equal(getFloorNodes(route, 0).length, 1);
  assert.deepEqual(getFloorNodes(route, 999), []);
  assert.deepEqual(getSuccessorIds(route, 'nope'), []);

  const lastFloor = route.floors.length - 1;
  assert.deepEqual(getSuccessorIds(route, `f${lastFloor}n0`), [], 'final boss leads nowhere');
});

test('validateRoute rejects malformed graphs', () => {
  const route = generateRoute(0x4543484f);
  assert.ok(validateRoute(route));

  assert.equal(validateRoute(null), false);
  assert.equal(validateRoute({}), false);
  assert.equal(validateRoute({ ...route, routeVersion: 'nope' }), false);
  assert.equal(validateRoute({ ...route, floors: [] }), false);
  assert.equal(validateRoute({ ...route, edges: 'nope' }), false);

  // an edge pointing at a node that does not exist
  const brokenEdge = { ...route, edges: [...route.edges, ['f0n0', 'f99n9']] };
  assert.equal(validateRoute(brokenEdge), false);

  // a boss smuggled onto an entry floor
  const floors = route.floors.map((floor) => ({
    ...floor,
    nodes: floor.nodes.map((node) => ({ ...node })),
  }));
  floors[0].nodes[0].type = 'boss';
  assert.equal(validateRoute({ ...route, floors }), false);

  // an empty floor
  const emptied = route.floors.map((floor, i) => (i === 1 ? { ...floor, nodes: [] } : floor));
  assert.equal(validateRoute({ ...route, floors: emptied }), false);
});

test('ROUTE_VERSION is stable', () => {
  assert.equal(ROUTE_VERSION, 'echo-forge-route-v1');
  assert.equal(generateRoute(1).routeVersion, ROUTE_VERSION);
});
