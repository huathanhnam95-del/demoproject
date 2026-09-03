// @ts-check

import { RUN_SCHEMA_VERSION, assertRunEventType } from './run-contract.js';
import { createInitialCombatState, reduceCombat } from './combat-reducer.js';
import { WARDENS } from './wardens.js';
import { deriveRewardOffer, applyRewardEffect } from './rewards.js';

function freeze(object) {
  return Object.freeze(object);
}

/**
 * Creates the initial state for an Echo Forge multi-fight run.
 *
 * @param {Object} [options]
 * @param {string} [options.level='B1']
 * @param {number} [options.seed=0x4543484f]
 * @param {string} [options.runId]
 * @param {number} [options.heroMaxHp=100]
 * @returns {Object}
 */
export function createInitialRunState({
  level = 'B1',
  seed = 0x4543484f,
  runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  heroMaxHp = 100,
} = {}) {
  return freeze({
    schemaVersion: RUN_SCHEMA_VERSION,
    runId,
    status: 'active',
    level,
    seed,
    wardenIndex: 0,
    heroMaxHp,
    carriedHeroHp: heroMaxHp,
    modifiers: freeze({
      focusStart: 1,
      resonanceStart: 0,
      blockReliefBonus: 0,
    }),
    rewardOffer: null,
    claimedRewards: freeze([]),
    combat: null,
    ledger: freeze([]),
  });
}

function spawnCombatForWarden(runState) {
  const warden = WARDENS[runState.wardenIndex] || WARDENS[0];
  const heroMaxHp = Math.max(1, Number.isFinite(Number(runState.heroMaxHp)) ? Number(runState.heroMaxHp) : 100);
  const carried = Number(runState.carriedHeroHp);
  const heroHp = Math.max(1, Math.min(heroMaxHp, Number.isFinite(carried) ? carried : heroMaxHp));
  const initial = createInitialCombatState({
    level: runState.level,
    heroMaxHp,
    heroHp,
    enemyMaxHp: warden.maxHp,
    heroFocus: runState.modifiers.focusStart,
    heroResonance: runState.modifiers.resonanceStart,
  });
  return reduceCombat(initial, { type: 'START_COMBAT' });
}

function emitEvent(events, type, payload = {}) {
  assertRunEventType(type);
  events.push(freeze({ type, payload: freeze({ ...payload }) }));
}

/**
 * Pure run reducer that manages multi-fight progression, carried HP, and reward drafting.
 * Returns separated { state, events, combatEvents } channels.
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

  switch (action.type) {
    case 'START_RUN': {
      const runId = action.runId || state.runId;
      const seed = action.seed !== undefined ? action.seed : state.seed;
      const level = action.level || state.level;
      const heroMaxHp = action.heroMaxHp || state.heroMaxHp || 100;

      const baseState = createInitialRunState({ level, seed, runId, heroMaxHp });
      const combatSpawn = spawnCombatForWarden(baseState);

      emitEvent(runEvents, 'run.started', { runId, level, seed });
      emitEvent(runEvents, 'run.fight.started', {
        wardenIndex: 0,
        wardenId: WARDENS[0].id,
        wardenName: WARDENS[0].name,
      });

      const nextState = freeze({
        ...baseState,
        combat: combatSpawn.state,
      });

      return {
        state: nextState,
        events: freeze(runEvents),
        combatEvents: freeze(combatSpawn.events),
      };
    }

    case 'ENTER_FIGHT': {
      if (state.status !== 'active') return { state, events: freeze([]), combatEvents: freeze([]) };
      const combatSpawn = spawnCombatForWarden(state);
      const warden = WARDENS[state.wardenIndex] || WARDENS[0];

      emitEvent(runEvents, 'run.fight.started', {
        wardenIndex: state.wardenIndex,
        wardenId: warden.id,
        wardenName: warden.name,
      });

      return {
        state: freeze({ ...state, combat: combatSpawn.state, rewardOffer: null }),
        events: freeze(runEvents),
        combatEvents: freeze(combatSpawn.events),
      };
    }

    case 'COMBAT_ACTION': {
      if (!state.combat || !['active', 'reward_pending'].includes(state.status)) {
        return { state, events: freeze([]), combatEvents: freeze([]) };
      }

      const combatResult = reduceCombat(state.combat, action.combatAction);
      combatEvents = [...combatResult.events];

      const currentWarden = WARDENS[state.wardenIndex] || WARDENS[0];
      const carriedHeroHp = combatResult.state.hero.hp;
      const combatStatus = combatResult.state.status;

      let nextRunStatus = state.status;
      let rewardOffer = state.rewardOffer;
      let ledger = [...state.ledger];

      if (combatStatus === 'victory') {
        ledger.push(freeze({
          wardenIndex: state.wardenIndex,
          wardenId: currentWarden.id,
          outcome: 'victory',
          rounds: combatResult.state.round,
          finalHeroHp: carriedHeroHp,
        }));

        emitEvent(runEvents, 'run.fight.completed', {
          wardenIndex: state.wardenIndex,
          wardenId: currentWarden.id,
          outcome: 'victory',
        });

        const isLastWarden = state.wardenIndex >= WARDENS.length - 1;
        const singleFight = Boolean(action.singleFight);

        if (isLastWarden || singleFight) {
          nextRunStatus = 'victory';
          emitEvent(runEvents, 'run.completed', {
            runId: state.runId,
            outcome: 'victory',
            fightsCompleted: state.wardenIndex + 1,
            carriedHeroHp,
          });
        } else {
          nextRunStatus = 'reward_pending';
          const offer = deriveRewardOffer(state.seed, state.wardenIndex);
          rewardOffer = freeze(offer);
          emitEvent(runEvents, 'run.reward.offered', {
            wardenIndex: state.wardenIndex,
            offer: offer.map((r) => r.id),
          });
        }
      } else if (combatStatus === 'defeat') {
        ledger.push(freeze({
          wardenIndex: state.wardenIndex,
          wardenId: currentWarden.id,
          outcome: 'defeat',
          rounds: combatResult.state.round,
          finalHeroHp: carriedHeroHp,
        }));

        nextRunStatus = 'defeat';
        emitEvent(runEvents, 'run.fight.completed', {
          wardenIndex: state.wardenIndex,
          wardenId: currentWarden.id,
          outcome: 'defeat',
        });
        emitEvent(runEvents, 'run.failed', {
          runId: state.runId,
          wardenIndex: state.wardenIndex,
          carriedHeroHp,
        });
      } else if (combatStatus === 'abandoned') {
        nextRunStatus = 'abandoned';
        emitEvent(runEvents, 'run.abandoned', {
          runId: state.runId,
          wardenIndex: state.wardenIndex,
        });
      }

      const nextState = freeze({
        ...state,
        status: nextRunStatus,
        carriedHeroHp,
        rewardOffer,
        combat: combatResult.state,
        ledger: freeze(ledger),
      });

      return {
        state: nextState,
        events: freeze(runEvents),
        combatEvents: freeze(combatEvents),
      };
    }

    case 'CLAIM_REWARD': {
      if (state.status !== 'reward_pending' || !state.rewardOffer) {
        return { state, events: freeze([]), combatEvents: freeze([]) };
      }

      const rewardId = action.rewardId;
      const isValidOffer = state.rewardOffer.some((r) => r.id === rewardId);
      if (!isValidOffer) {
        throw new Error(`Invalid reward claimed: ${rewardId}`);
      }

      const updatedProps = applyRewardEffect(state, rewardId);
      const claimedRewards = freeze([...state.claimedRewards, rewardId]);
      const nextWardenIndex = state.wardenIndex + 1;
      const nextWarden = WARDENS[nextWardenIndex] || WARDENS[WARDENS.length - 1];

      emitEvent(runEvents, 'run.reward.claimed', {
        rewardId,
        wardenIndex: state.wardenIndex,
      });

      const nextStateIntermediate = freeze({
        ...state,
        ...updatedProps,
        wardenIndex: nextWardenIndex,
        status: 'active',
        claimedRewards,
        rewardOffer: null,
      });

      const combatSpawn = spawnCombatForWarden(nextStateIntermediate);

      emitEvent(runEvents, 'run.fight.started', {
        wardenIndex: nextWardenIndex,
        wardenId: nextWarden.id,
        wardenName: nextWarden.name,
      });

      const finalNextState = freeze({
        ...nextStateIntermediate,
        combat: combatSpawn.state,
      });

      return {
        state: finalNextState,
        events: freeze(runEvents),
        combatEvents: freeze(combatSpawn.events),
      };
    }

    case 'ABANDON_RUN': {
      if (['victory', 'defeat', 'abandoned'].includes(state.status)) {
        return { state, events: freeze([]), combatEvents: freeze([]) };
      }

      emitEvent(runEvents, 'run.abandoned', {
        runId: state.runId,
        wardenIndex: state.wardenIndex,
      });

      let nextCombat = state.combat;
      if (nextCombat && nextCombat.status === 'active') {
        const combatResult = reduceCombat(nextCombat, { type: 'ABANDON_COMBAT' });
        nextCombat = combatResult.state;
        combatEvents = [...combatResult.events];
      }

      return {
        state: freeze({
          ...state,
          status: 'abandoned',
          combat: nextCombat,
        }),
        events: freeze(runEvents),
        combatEvents: freeze(combatEvents),
      };
    }

    default:
      return { state, events: freeze([]), combatEvents: freeze([]) };
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
