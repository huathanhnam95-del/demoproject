export const ECHO_FORGE_EVENT_TYPES = Object.freeze([
  'sandbox.setup.completed',
  'combat.started',
  'player.action.selected',
  'recording.started',
  'recording.stopped',
  'analysis.pending',
  'analysis.resolved',
  'analysis.noop',
  'player.attack.resolved',
  'enemy.intent.presented',
  'player.block.resolved',
  'player.parry.started',
  'player.parry.resolved',
  'combat.damage.applied',
  'combat.focus.changed',
  'combat.resonance.ready',
  'combat.resonance.consumed',
  'combat.victory',
  'combat.defeat',
  'combat.abandoned',
  'telemetry.exported',
]);

export const EVENT_OWNERS = Object.freeze({
  'sandbox.setup.completed': 'sandbox',
  'combat.started': 'combat',
  'player.action.selected': 'sandbox',
  'recording.started': 'recorder',
  'recording.stopped': 'recorder',
  'analysis.pending': 'analyzer',
  'analysis.resolved': 'combat',
  'analysis.noop': 'combat',
  'player.attack.resolved': 'combat',
  'enemy.intent.presented': 'combat',
  'player.block.resolved': 'combat',
  'player.parry.started': 'recorder',
  'player.parry.resolved': 'combat',
  'combat.damage.applied': 'combat',
  'combat.focus.changed': 'combat',
  'combat.resonance.ready': 'combat',
  'combat.resonance.consumed': 'combat',
  'combat.victory': 'combat',
  'combat.defeat': 'combat',
  'combat.abandoned': 'combat',
  'telemetry.exported': 'telemetry',
});

export function assertEchoForgeEventType(type) {
  if (!ECHO_FORGE_EVENT_TYPES.includes(type)) {
    throw new RangeError(`unsupported Echo Forge event: ${type}`);
  }
  return type;
}
