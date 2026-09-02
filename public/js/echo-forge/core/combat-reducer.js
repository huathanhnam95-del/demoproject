import { createAnalysisResult, isCombatNoopAnalysis } from '../contracts/analysis-result.js';
import { assertEchoForgeEventType } from '../contracts/events.js';
import { ATTACK_CARDS, COMBAT_POLICY, assertCefrLevel } from './policy.js';
import { calculateAttackDamage, resolveBlock, resolveParry } from './combat-math.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function event(type, payload = {}) {
  assertEchoForgeEventType(type);
  return freeze({ type, payload });
}

function result(state, events) {
  return Object.freeze({ state, events: Object.freeze([...events]) });
}

function assertActiveTurn(state, turn) {
  if (state.status !== 'active') throw new Error(`combat is terminal or not active: ${state.status}`);
  if (state.turn !== turn) throw new Error(`expected ${turn} turn, received ${state.turn}`);
}

function finishDefence(state, hero, enemy, events) {
  if (hero.hp <= 0) {
    return result(
      freeze({ ...state, status: 'defeat', turn: null, hero, enemy }),
      [...events, event('combat.defeat')],
    );
  }
  if (enemy.hp <= 0) {
    return result(
      freeze({ ...state, status: 'victory', turn: null, hero, enemy }),
      [...events, event('combat.victory')],
    );
  }
  return result(freeze({ ...state, turn: 'player', round: state.round + 1, hero, enemy }), events);
}

export function createInitialCombatState({
  level,
  heroMaxHp = COMBAT_POLICY.heroMaxHp,
  enemyMaxHp = COMBAT_POLICY.enemyMaxHp,
} = {}) {
  assertCefrLevel(level);
  if (!Number.isFinite(heroMaxHp) || heroMaxHp <= 0) throw new RangeError('heroMaxHp must be positive');
  if (!Number.isFinite(enemyMaxHp) || enemyMaxHp <= 0) throw new RangeError('enemyMaxHp must be positive');
  return freeze({
    schemaVersion: 'echo-forge-combat-v1',
    status: 'setup',
    level,
    locale: COMBAT_POLICY.locale,
    turn: null,
    round: 0,
    hero: {
      hp: heroMaxHp,
      maxHp: heroMaxHp,
      focus: COMBAT_POLICY.focus.start,
      resonance: COMBAT_POLICY.resonance.start,
      combo: COMBAT_POLICY.combo.start,
    },
    enemy: { hp: enemyMaxHp, maxHp: enemyMaxHp },
  });
}

function resolvePlayerAttack(state, action) {
  assertActiveTurn(state, 'player');
  const card = ATTACK_CARDS[action.cardId];
  if (!card) throw new RangeError(`unknown attack card: ${action.cardId}`);
  const analysis = createAnalysisResult(action.analysis);
  if (isCombatNoopAnalysis(analysis)) {
    return result(state, [event('analysis.noop', { status: analysis.status, reasonCode: analysis.reasonCode })]);
  }
  if (analysis.evaluationMode !== card.evaluationMode) {
    throw new RangeError(`evaluationMode ${analysis.evaluationMode} does not match ${card.evaluationMode}`);
  }
  if (action.useBurst !== undefined && typeof action.useBurst !== 'boolean') {
    throw new TypeError('useBurst must be a boolean when provided');
  }
  if (state.hero.focus < card.focusCost) throw new RangeError('insufficient Focus');
  if (action.useBurst && state.hero.resonance < COMBAT_POLICY.burst.requiredResonance) {
    throw new RangeError('Resonance Burst requires 100 Resonance');
  }

  const scored = analysis.status === 'scored';
  const burstApplied = action.useBurst === true && scored;
  const damage = calculateAttackDamage({
    base: card.baseDamage,
    score: analysis.score,
    combo: state.hero.combo,
    burst: burstApplied,
  });
  const previousResonance = state.hero.resonance;
  let resonance = previousResonance - (burstApplied ? COMBAT_POLICY.burst.requiredResonance : 0);
  if (scored) {
    const rawGain = Math.round(analysis.score * COMBAT_POLICY.resonance.gainFactor);
    resonance += Math.min(COMBAT_POLICY.resonance.maxGain, Math.max(COMBAT_POLICY.resonance.minGain, rawGain));
  }
  resonance = Math.min(COMBAT_POLICY.resonance.max, Math.max(0, resonance));

  const hero = {
    ...state.hero,
    focus: state.hero.focus - card.focusCost,
    resonance,
    combo: scored ? state.hero.combo + 1 : 0,
  };
  const enemy = { ...state.enemy, hp: Math.max(0, state.enemy.hp - damage) };
  const events = [
    event('analysis.resolved', { status: analysis.status, score: analysis.score }),
    event('player.attack.resolved', { cardId: card.id, damage, burstApplied }),
    event('combat.damage.applied', { target: 'enemy', damage }),
  ];
  if (card.focusCost > 0) events.push(event('combat.focus.changed', { focus: hero.focus }));
  if (burstApplied) events.push(event('combat.resonance.consumed', { amount: 100 }));
  if (previousResonance < 100 && resonance === 100) events.push(event('combat.resonance.ready'));

  if (enemy.hp === 0) {
    return result(
      freeze({ ...state, status: 'victory', turn: null, hero, enemy }),
      [...events, event('combat.victory')],
    );
  }
  return result(
    freeze({ ...state, turn: 'enemy', hero, enemy }),
    [...events, event('enemy.intent.presented')],
  );
}

function resolveEnemyBlock(state, action) {
  assertActiveTurn(state, 'enemy');
  const resolution = resolveBlock(action);
  const previousFocus = state.hero.focus;
  const hero = {
    ...state.hero,
    hp: Math.max(0, state.hero.hp - resolution.damage),
    focus: Math.min(COMBAT_POLICY.focus.max, state.hero.focus + resolution.focusRestored),
  };
  const events = [
    event('player.block.resolved', { outcome: action.outcome, incomingMultiplier: resolution.incomingMultiplier }),
    event('combat.damage.applied', { target: 'hero', damage: resolution.damage }),
  ];
  if (hero.focus !== previousFocus) events.push(event('combat.focus.changed', { focus: hero.focus }));
  return finishDefence(state, hero, { ...state.enemy }, events);
}

function resolveEnemyParry(state, action) {
  assertActiveTurn(state, 'enemy');
  let score = action.score;
  let analysis = null;
  if (action.analysis) {
    analysis = createAnalysisResult(action.analysis);
    if (isCombatNoopAnalysis(analysis)) {
      return result(state, [event('analysis.noop', { status: analysis.status, reasonCode: analysis.reasonCode })]);
    }
    score = analysis.score;
  }
  const calculatedResolution = resolveParry({ score, timing: action.timing, enemyBaseDamage: action.enemyBaseDamage });
  const resolution = analysis?.status === 'incorrect'
    ? Object.freeze({ ...calculatedResolution, reflectedDamage: 0 })
    : calculatedResolution;
  const hero = { ...state.hero, hp: Math.max(0, state.hero.hp - resolution.damage) };
  const enemy = { ...state.enemy, hp: Math.max(0, state.enemy.hp - resolution.reflectedDamage) };
  const events = [
    ...(analysis ? [event('analysis.resolved', { status: analysis.status, score: analysis.score })] : []),
    event('player.parry.resolved', resolution),
    event('combat.damage.applied', { target: 'hero', damage: resolution.damage }),
  ];
  if (resolution.reflectedDamage > 0) {
    events.push(event('combat.damage.applied', { target: 'enemy', damage: resolution.reflectedDamage }));
  }
  return finishDefence(state, hero, enemy, events);
}

export function reduceCombat(state, action) {
  if (!state || typeof state !== 'object') throw new TypeError('state is required');
  if (!action || typeof action.type !== 'string') throw new TypeError('action.type is required');
  switch (action.type) {
    case 'START_COMBAT':
      if (state.status !== 'setup') throw new Error('combat can only start from setup');
      return result(
        freeze({ ...state, status: 'active', turn: 'player', round: 1 }),
        [event('combat.started')],
      );
    case 'SET_LEVEL':
      if (state.status !== 'setup') throw new Error('level can only change during setup');
      assertCefrLevel(action.level);
      return result(freeze({ ...state, level: action.level }), []);
    case 'RESOLVE_PLAYER_ATTACK':
      return resolvePlayerAttack(state, action);
    case 'RESOLVE_BLOCK':
      return resolveEnemyBlock(state, action);
    case 'RESOLVE_PARRY':
      return resolveEnemyParry(state, action);
    case 'ABANDON_COMBAT':
      if (state.status !== 'setup' && state.status !== 'active') throw new Error('combat is terminal');
      return result(
        freeze({ ...state, status: 'abandoned', turn: null }),
        [event('combat.abandoned')],
      );
    default:
      throw new RangeError(`unknown combat action: ${action.type}`);
  }
}

export function replayCombat(initialState, actions) {
  let state = initialState;
  const events = [];
  for (const action of actions) {
    const result = reduceCombat(state, action);
    state = result.state;
    events.push(...result.events);
  }
  return freeze({ state, events });
}
