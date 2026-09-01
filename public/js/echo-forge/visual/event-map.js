import { ECHO_FORGE_EVENT_TYPES } from '../contracts/events.js';

export const EVENT_VISUAL_MAP = Object.freeze({
  'sandbox.setup.completed': 'idle',
  'combat.started': 'idle',
  'player.action.selected': 'windUp',
  'recording.started': 'windUp',
  'recording.stopped': 'windUp',
  'analysis.pending': 'analysisHold',
  'analysis.resolved': 'result',
  'analysis.noop': 'idle',
  'player.attack.resolved': 'result',
  'enemy.intent.presented': 'enemyTelegraph',
  'player.block.resolved': 'result',
  'player.parry.started': 'windUp',
  'player.parry.resolved': 'result',
  'combat.damage.applied': 'result',
  'combat.focus.changed': 'idle',
  'combat.resonance.ready': 'resonanceReady',
  'combat.resonance.consumed': 'result',
  'combat.victory': 'victory',
  'combat.defeat': 'defeat',
  'combat.abandoned': 'idle',
  'telemetry.exported': 'idle',
});

if (Object.keys(EVENT_VISUAL_MAP).length !== ECHO_FORGE_EVENT_TYPES.length) {
  throw new Error('Echo Forge visual event map is incomplete');
}
