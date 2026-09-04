// @ts-check

import { RUN_SCHEMA_VERSION, assertRunEventType } from './run-contract.js';
import { createInitialCombatState, reduceCombat } from './combat-reducer.js';
import { WARDENS } from './wardens.js';
import { deriveRewardOffer, deriveCacheOffer, applyRewardEffect, applyRestEffect } from './rewards.js';
import {
  ACT_COUNT,
  actForFloor,
  generateRoute,
  getAct,
  getNode,
  getSuccessorIds,
  isCombatNode,
  nodeCombatProfile,
} from './route.js';

function freeze(object) {
  return Object.freeze(object);
}

/**
 * Creates the initial state for an Echo Forge run.
 *
 * @param {Object} [options]
 * @param {string} [options.level='B1']
 * @param {number} [options.seed=0x4543484f]
 * @param {string} [options.runId]
 * @param {number} [options.heroMaxHp=100]
 * @param {number} [options.floorsPerAct]
 * @returns {Object}
 */
export function createInitialRunState({
  level = 'B1',
  seed = 0x4543484f,
  runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  heroMaxHp = 100,
  floorsPerAct,
} = {}) {
  const route = generateRoute(seed, { floorsPerAct });
  const entryNode = route.floors[0].nodes[0];

  return freeze({
    schemaVersion: RUN_SCHEMA_VERSION,
    runId,
    status: 'active',
    level,
    seed,

    route,
    // Mirrored at the top level so the persisted slice can rebuild the same
    // graph shape without storing the graph itself.
    floorsPerAct: route.floorsPerAct,
    act: 0,
    floor: 0,
    nodeId: entryNode.id,
    visitedNodeIds: freeze([entryNode.id]),
    availableNodeIds: freeze([]),

    wardenIndex: 0,
    heroMaxHp,
    carriedHeroHp: heroMaxHp,
    modifiers: freeze({
      focusStart: 1,
      resonanceStart: 0,
      blockReliefBonus: 0,
    }),
    rewardOffer: null,
    rewardSource: null,
    claimedRewards: freeze([]),
    combat: null,
    ledger: freeze([]),
  });
}

/**
 * Spawns combat for a route node. Every fight currently shares one stat block;
 * `nodeCombatProfile` is the single seam where that will change.
 */
function spawnCombatForNode(runState, node) {
  const profile = nodeCombatProfile(node);
  const heroMaxHp = Math.max(1, Number.isFinite(Number(runState.heroMaxHp)) ? Number(runState.heroMaxHp) : 100);
  const carried = Number(runState.carriedHeroHp);
  const heroHp = Math.max(1, Math.min(heroMaxHp, Number.isFinite(carried) ? carried : heroMaxHp));
  const initial = createInitialCombatState({
    level: runState.level,
    heroMaxHp,
    heroHp,
    enemyMaxHp: profile.maxHp,
    heroFocus: runState.modifiers.focusStart,
    heroResonance: runState.modifiers.resonanceStart,
  });
  return reduceCombat(initial, { type: 'START_COMBAT' });
}

function emitEvent(events, type, payload = {}) {
  assertRunEventType(type);
  events.push(freeze({ type, payload: freeze({ ...payload }) }));
}

/** Warden index for an act, used for the derived compatibility field. */
function wardenIndexForAct(act) {
  return Math.max(0, Math.min(WARDENS.length - 1, act));
}

/**
 * Opens the map at `nodeId`'s successors. Returns the state patch plus the
 * events describing the choice on offer.
 */
function offerMap(state, fromNodeId, runEvents) {
  const availableNodeIds = getSuccessorIds(state.route, fromNodeId);
  const nodes = availableNodeIds
    .map((id) => getNode(state.route, id))
    .filter(Boolean);

  emitEvent(runEvents, 'run.map.offered', {
    act: nodes[0] ? nodes[0].act : state.act,
    floor: nodes[0] ? nodes[0].floor : state.floor,
    nodeIds: [...availableNodeIds],
    nodeTypes: nodes.map((node) => node.type),
  });

  return {
    status: 'map_pending',
    availableNodeIds: freeze([...availableNodeIds]),
    combat: null,
    rewardOffer: null,
    rewardSource: null,
  };
}

/**
 * Pure run reducer. Manages act progression, branching route traversal,
 * carried HP, and reward drafting.
 *
 * @param {Object} state
 * @param {Object} action
 * @returns {{ state: Object, events: readonly Object[], combatEvents: readonly Object[] }}
 */
export function reduceRun(state, action) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('state must be an object');
  }
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    throw new TypeError('action must be an object with string type');
  }

  const runEvents = [];
  let combatEvents = [];
  const noop = { state, events: freeze([]), combatEvents: freeze([]) };

  switch (action.type) {
    case 'START_RUN': {
      const runId = action.runId || state.runId;
      const seed = action.seed !== undefined ? action.seed : state.seed;
      const level = action.level || state.level;
      const heroMaxHp = action.heroMaxHp || state.heroMaxHp || 100;
      const floorsPerAct = action.floorsPerAct !== undefined
        ? action.floorsPerAct
        : state.route?.floorsPerAct;

      const baseState = createInitialRunState({ level, seed, runId, heroMaxHp, floorsPerAct });
      const entryNode = baseState.route.floors[0].nodes[0];
      const act = getAct(0);
      const combatSpawn = spawnCombatForNode(baseState, entryNode);

      emitEvent(runEvents, 'run.started', { runId, level, seed });
      emitEvent(runEvents, 'run.route.generated', {
        runId,
        seed,
        floorsPerAct: baseState.route.floorsPerAct,
        floorCount: baseState.route.floors.length,
        nodeCounts: baseState.route.floors.map((floor) => floor.nodes.length),
      });
      emitEvent(runEvents, 'run.act.entered', {
        act: 0,
        stageId: act.stageId,
        title: act.title,
        numeral: act.numeral,
        colorToken: act.colorToken,
      });
      emitEvent(runEvents, 'run.node.entered', {
        nodeId: entryNode.id,
        act: entryNode.act,
        floor: entryNode.floor,
        nodeType: entryNode.type,
        name: entryNode.name,
        wardenId: entryNode.wardenId,
      });
      emitEvent(runEvents, 'run.fight.started', {
        wardenIndex: 0,
        wardenId: entryNode.wardenId,
        wardenName: entryNode.name,
        nodeId: entryNode.id,
        nodeType: entryNode.type,
      });

      return {
        state: freeze({ ...baseState, combat: combatSpawn.state }),
        events: freeze(runEvents),
        combatEvents: freeze(combatSpawn.events),
      };
    }

    case 'ENTER_FIGHT': {
      if (state.status !== 'active') return noop;
      const node = getNode(state.route, state.nodeId);
      if (!node || !isCombatNode(node.type)) return noop;

      const combatSpawn = spawnCombatForNode(state, node);

      emitEvent(runEvents, 'run.fight.started', {
        wardenIndex: state.wardenIndex,
        wardenId: node.wardenId,
        wardenName: node.name,
        nodeId: node.id,
        nodeType: node.type,
      });

      return {
        state: freeze({ ...state, combat: combatSpawn.state, rewardOffer: null }),
        events: freeze(runEvents),
        combatEvents: freeze(combatSpawn.events),
      };
    }

    case 'COMBAT_ACTION': {
      if (!state.combat || !['active', 'reward_pending'].includes(state.status)) {
        return noop;
      }

      const combatResult = reduceCombat(state.combat, action.combatAction);
      combatEvents = [...combatResult.events];

      const node = getNode(state.route, state.nodeId);
      const carriedHeroHp = combatResult.state.hero.hp;
      const combatStatus = combatResult.state.status;

      let nextStatus = state.status;
      let nextAct = state.act;
      let nextFloor = state.floor;
      let availableNodeIds = state.availableNodeIds;
      let rewardOffer = state.rewardOffer;
      let rewardSource = state.rewardSource;
      const ledger = [...state.ledger];

      if (combatStatus === 'victory') {
        ledger.push(freeze({
          wardenIndex: state.wardenIndex,
          wardenId: node ? node.wardenId : null,
          nodeId: state.nodeId,
          nodeType: node ? node.type : null,
          act: state.act,
          outcome: 'victory',
          rounds: combatResult.state.round,
          finalHeroHp: carriedHeroHp,
        }));

        emitEvent(runEvents, 'run.fight.completed', {
          wardenIndex: state.wardenIndex,
          wardenId: node ? node.wardenId : null,
          nodeId: state.nodeId,
          nodeType: node ? node.type : null,
          outcome: 'victory',
        });

        const isBoss = node && node.type === 'boss';
        const isFinalAct = state.act >= ACT_COUNT - 1;
        const singleFight = Boolean(action.singleFight);

        if (singleFight || (isBoss && isFinalAct)) {
          nextStatus = 'victory';
          emitEvent(runEvents, 'run.completed', {
            runId: state.runId,
            outcome: 'victory',
            fightsCompleted: ledger.length,
            actsCompleted: isBoss ? state.act + 1 : state.act,
            carriedHeroHp,
          });
        } else {
          if (isBoss) {
            const completed = getAct(state.act);
            emitEvent(runEvents, 'run.act.completed', {
              act: state.act,
              stageId: completed.stageId,
              title: completed.title,
            });
            nextAct = state.act + 1;
            nextFloor = nextAct * state.route.floorsPerAct;
            const entered = getAct(nextAct);
            emitEvent(runEvents, 'run.act.entered', {
              act: nextAct,
              stageId: entered.stageId,
              title: entered.title,
              numeral: entered.numeral,
              colorToken: entered.colorToken,
            });
          }

          nextStatus = 'reward_pending';
          rewardSource = isBoss ? 'boss' : 'fight';
          const offer = deriveRewardOffer(state.seed, state.floor);
          rewardOffer = freeze(offer);
          emitEvent(runEvents, 'run.reward.offered', {
            act: state.act,
            floor: state.floor,
            wardenIndex: state.wardenIndex,
            source: rewardSource,
            offer: offer.map((reward) => reward.id),
          });
        }
      } else if (combatStatus === 'defeat') {
        ledger.push(freeze({
          wardenIndex: state.wardenIndex,
          wardenId: node ? node.wardenId : null,
          nodeId: state.nodeId,
          nodeType: node ? node.type : null,
          act: state.act,
          outcome: 'defeat',
          rounds: combatResult.state.round,
          finalHeroHp: carriedHeroHp,
        }));

        nextStatus = 'defeat';
        emitEvent(runEvents, 'run.fight.completed', {
          wardenIndex: state.wardenIndex,
          wardenId: node ? node.wardenId : null,
          nodeId: state.nodeId,
          nodeType: node ? node.type : null,
          outcome: 'defeat',
        });
        emitEvent(runEvents, 'run.failed', {
          runId: state.runId,
          act: state.act,
          floor: state.floor,
          wardenIndex: state.wardenIndex,
          carriedHeroHp,
        });
      } else if (combatStatus === 'abandoned') {
        nextStatus = 'abandoned';
        emitEvent(runEvents, 'run.abandoned', {
          runId: state.runId,
          act: state.act,
          floor: state.floor,
          wardenIndex: state.wardenIndex,
        });
      }

      return {
        state: freeze({
          ...state,
          status: nextStatus,
          act: nextAct,
          floor: nextFloor,
          wardenIndex: wardenIndexForAct(nextAct),
          availableNodeIds,
          carriedHeroHp,
          rewardOffer,
          rewardSource,
          combat: combatResult.state,
          ledger: freeze(ledger),
        }),
        events: freeze(runEvents),
        combatEvents: freeze(combatEvents),
      };
    }

    case 'CLAIM_REWARD': {
      if (state.status !== 'reward_pending' || !state.rewardOffer) {
        return noop;
      }

      const rewardId = action.rewardId;
      const isValidOffer = state.rewardOffer.some((reward) => reward.id === rewardId);
      if (!isValidOffer) {
        throw new Error(`Invalid reward claimed: ${rewardId}`);
      }

      const updatedProps = applyRewardEffect(state, rewardId);
      const claimedRewards = freeze([...state.claimedRewards, rewardId]);

      emitEvent(runEvents, 'run.reward.claimed', {
        rewardId,
        act: state.act,
        floor: state.floor,
        source: state.rewardSource,
      });

      // Claiming no longer spawns the next fight. It opens the map instead.
      const intermediate = { ...state, ...updatedProps, claimedRewards };
      const mapPatch = offerMap(intermediate, state.nodeId, runEvents);

      return {
        state: freeze({ ...intermediate, ...mapPatch }),
        events: freeze(runEvents),
        combatEvents: freeze([]),
      };
    }

    case 'SELECT_NODE': {
      if (state.status !== 'map_pending') return noop;

      const nodeId = action.nodeId;
      // The membership check is the boundary: only successors of where the
      // player actually stands can be entered.
      if (!state.availableNodeIds.includes(nodeId)) return noop;

      const node = getNode(state.route, nodeId);
      if (!node) return noop;

      const visitedNodeIds = freeze([...state.visitedNodeIds, node.id]);
      const actIndex = node.act;
      const base = {
        ...state,
        act: actIndex,
        floor: node.floor,
        nodeId: node.id,
        visitedNodeIds,
        wardenIndex: wardenIndexForAct(actIndex),
        availableNodeIds: freeze([]),
      };

      emitEvent(runEvents, 'run.node.entered', {
        nodeId: node.id,
        act: node.act,
        floor: node.floor,
        nodeType: node.type,
        name: node.name,
        wardenId: node.wardenId,
      });

      if (isCombatNode(node.type)) {
        const combatSpawn = spawnCombatForNode(base, node);
        emitEvent(runEvents, 'run.fight.started', {
          wardenIndex: base.wardenIndex,
          wardenId: node.wardenId,
          wardenName: node.name,
          nodeId: node.id,
          nodeType: node.type,
        });

        return {
          state: freeze({
            ...base,
            status: 'active',
            combat: combatSpawn.state,
            rewardOffer: null,
            rewardSource: null,
          }),
          events: freeze(runEvents),
          combatEvents: freeze(combatSpawn.events),
        };
      }

      if (node.type === 'rest') {
        const rested = applyRestEffect(base);
        emitEvent(runEvents, 'run.node.resolved', {
          nodeId: node.id,
          nodeType: 'rest',
          effect: 'heal',
          healAmount: rested.healed,
          carriedHeroHp: rested.carriedHeroHp,
        });

        const healedState = {
          ...base,
          heroMaxHp: rested.heroMaxHp,
          carriedHeroHp: rested.carriedHeroHp,
          modifiers: freeze(rested.modifiers),
        };
        const mapPatch = offerMap(healedState, node.id, runEvents);

        return {
          state: freeze({ ...healedState, ...mapPatch }),
          events: freeze(runEvents),
          combatEvents: freeze([]),
        };
      }

      // cache
      const offer = deriveCacheOffer(state.seed, node.floor);
      emitEvent(runEvents, 'run.node.resolved', {
        nodeId: node.id,
        nodeType: 'cache',
        effect: 'reward_offer',
        offer: offer.map((reward) => reward.id),
      });
      emitEvent(runEvents, 'run.reward.offered', {
        act: node.act,
        floor: node.floor,
        wardenIndex: base.wardenIndex,
        source: 'cache',
        offer: offer.map((reward) => reward.id),
      });

      return {
        state: freeze({
          ...base,
          status: 'reward_pending',
          combat: null,
          rewardOffer: freeze(offer),
          rewardSource: 'cache',
        }),
        events: freeze(runEvents),
        combatEvents: freeze([]),
      };
    }

    case 'ABANDON_RUN': {
      if (['victory', 'defeat', 'abandoned'].includes(state.status)) {
        return noop;
      }

      emitEvent(runEvents, 'run.abandoned', {
        runId: state.runId,
        act: state.act,
        floor: state.floor,
        nodeId: state.nodeId,
        wardenIndex: state.wardenIndex,
      });

      let nextCombat = state.combat;
      if (nextCombat && nextCombat.status === 'active') {
        const combatResult = reduceCombat(nextCombat, { type: 'ABANDON_COMBAT' });
        nextCombat = combatResult.state;
        combatEvents = [...combatResult.events];
      }

      return {
        state: freeze({ ...state, status: 'abandoned', combat: nextCombat }),
        events: freeze(runEvents),
        combatEvents: freeze(combatEvents),
      };
    }

    default:
      return noop;
  }
}

/**
 * Replays a run by left-folding actions over the initial state.
 *
 * @param {Object} initialRunState
 * @param {readonly Object[]} runActions
 * @returns {{ state: Object, events: readonly Object[], combatEvents: readonly Object[] }}
 */
export function replayRun(initialRunState, runActions = []) {
  let currentState = initialRunState;
  const allRunEvents = [];
  const allCombatEvents = [];

  for (const action of runActions) {
    const { state, events, combatEvents } = reduceRun(currentState, action);
    currentState = state;
    allRunEvents.push(...events);
    allCombatEvents.push(...combatEvents);
  }

  return {
    state: currentState,
    events: freeze(allRunEvents),
    combatEvents: freeze(allCombatEvents),
  };
}

/**
 * Rebuilds a full run state from a persisted slice. The route is regenerated
 * from the seed rather than restored, so a tampered save cannot inject a graph.
 *
 * @param {Object} savedRun
 * @returns {Object}
 */
export function createResumedRunState(savedRun) {
  const route = generateRoute(savedRun.seed, { floorsPerAct: savedRun.floorsPerAct });
  const floorsPerAct = route.floorsPerAct;

  const floor = Number.isInteger(savedRun.floor)
    ? Math.max(0, Math.min(route.floors.length - 1, savedRun.floor))
    : Math.max(0, Math.min(route.floors.length - 1, (savedRun.wardenIndex || 0) * floorsPerAct));
  const act = actForFloor(floor, floorsPerAct);

  const nodeId = savedRun.nodeId && getNode(route, savedRun.nodeId)
    ? savedRun.nodeId
    : route.floors[floor].nodes[0].id;

  const visitedNodeIds = Array.isArray(savedRun.visitedNodeIds) && savedRun.visitedNodeIds.length
    ? savedRun.visitedNodeIds.filter((id) => Boolean(getNode(route, id)))
    : deriveSpinePrefix(route, floor);

  const availableNodeIds = savedRun.status === 'map_pending'
    ? getSuccessorIds(route, nodeId)
    : [];

  return freeze({
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: savedRun.runId,
    status: savedRun.status,
    level: savedRun.level,
    seed: savedRun.seed,

    route,
    floorsPerAct: route.floorsPerAct,
    act,
    floor,
    nodeId,
    visitedNodeIds: freeze([...visitedNodeIds]),
    availableNodeIds: freeze([...availableNodeIds]),

    wardenIndex: wardenIndexForAct(act),
    heroMaxHp: savedRun.heroMaxHp,
    carriedHeroHp: savedRun.carriedHeroHp,
    modifiers: freeze({ ...savedRun.modifiers }),
    rewardOffer: savedRun.rewardOffer ? freeze([...savedRun.rewardOffer]) : null,
    rewardSource: savedRun.rewardSource || null,
    claimedRewards: freeze([...(savedRun.claimedRewards || [])]),
    combat: null,
    ledger: freeze([...(savedRun.ledger || [])]),
  });
}

/** The leftmost path up to and including `floor` — used to rebuild legacy saves. */
function deriveSpinePrefix(route, floor) {
  const ids = [];
  for (let f = 0; f <= floor; f += 1) {
    ids.push(`f${f}n0`);
  }
  return ids;
}
